using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Reference resolution through Document Manager.
    ///
    /// Split out of DocumentManagerAPI.cs, which is far past the size at which the workspace rules
    /// require a split before new functionality lands.
    ///
    /// Two properties matter here and neither held before:
    ///
    /// 1. A read reports whether it was answered. "No references" and "Document Manager could not
    ///    tell me" are different facts, and collapsing them into an empty array is what let a wrong
    ///    search-filter bitmask survive undetected - every read returned zero, instantly, and looked
    ///    like a file with no references.
    /// 2. A drawing's referenced configuration is available headlessly. ISwDMView carries it, so
    ///    nothing has to open the drawing in the user's SolidWorks to find out which configuration a
    ///    view shows.
    /// </summary>
    public partial class DocumentManagerAPI
    {
        /// <summary>
        /// Highest ISwDMDocumentNN the probes walk up to. The installed 2024 interop declares 29;
        /// the headroom costs one failed type lookup per version and survives an interop upgrade.
        /// </summary>
        private const int HighestProbedDocumentInterface = 40;

        /// <summary>First interface declaring GetAllExternalReferences4.</summary>
        private const int FirstInterfaceWithReferences4 = 13;

        /// <summary>First interface declaring GetAllExternalReferences5, which adds imported paths.</summary>
        private const int FirstInterfaceWithReferences5 = 21;

        /// <summary>First interface declaring GetViews.</summary>
        private const int FirstInterfaceWithViews = 10;

        /// <summary>Whether a reference read was answered at all, as distinct from what it found.</summary>
        public enum ReferenceReadStatus
        {
            /// <summary>Document Manager answered. The reference list is complete, empty included.</summary>
            Resolved,

            /// <summary>No Document Manager entry point answered. The reference list means nothing.</summary>
            Unavailable,
        }

        /// <summary>One external reference and whether Document Manager could resolve it on disk.</summary>
        public sealed class ExternalReference
        {
            public ExternalReference(string path, bool isBroken)
            {
                Path = path;
                IsBroken = isBroken;
            }

            /// <summary>Full path as Document Manager resolved it.</summary>
            public string Path { get; }

            /// <summary>True when GetAllExternalReferences reported this entry as broken.</summary>
            public bool IsBroken { get; }
        }

        /// <summary>The outcome of one external-reference read, including why it failed.</summary>
        public sealed class ExternalReferenceRead
        {
            private ExternalReferenceRead(
                ReferenceReadStatus status,
                IReadOnlyList<ExternalReference> references,
                string method,
                string? detail)
            {
                Status = status;
                References = references;
                Method = method;
                Detail = detail;
            }

            public ReferenceReadStatus Status { get; }

            /// <summary>Empty and meaningful when resolved; empty and meaningless when unavailable.</summary>
            public IReadOnlyList<ExternalReference> References { get; }

            /// <summary>Which Document Manager entry point answered, for the log and the wire.</summary>
            public string Method { get; }

            /// <summary>Why nothing answered, when nothing did.</summary>
            public string? Detail { get; }

            public bool IsResolved => Status == ReferenceReadStatus.Resolved;

            public static ExternalReferenceRead Resolved(
                IReadOnlyList<ExternalReference> references,
                string method) =>
                new ExternalReferenceRead(ReferenceReadStatus.Resolved, references, method, null);

            public static ExternalReferenceRead Unavailable(string detail) =>
                new ExternalReferenceRead(
                    ReferenceReadStatus.Unavailable,
                    Array.Empty<ExternalReference>(),
                    "none",
                    detail);
        }

        /// <summary>
        /// A model a drawing view refers to, in the shape SolidWorksAPI.GetExternalReferences emits
        /// for drawings, so no consumer can tell which one answered.
        /// </summary>
        public sealed class DrawingViewReference
        {
            public DrawingViewReference(string path, IReadOnlyList<string> configurations)
            {
                Path = path;
                Configurations = configurations;
            }

            public string Path { get; }

            public string FileName => System.IO.Path.GetFileName(Path);

            public string FileType => ClassifyFileType(Path);

            /// <summary>The first configuration any view of this model shows, or null.</summary>
            public string? Configuration => Configurations.Count > 0 ? Configurations[0] : null;

            /// <summary>Every distinct configuration this drawing's views show of this model.</summary>
            public IReadOnlyList<string> Configurations { get; }
        }

        /// <summary>
        /// Everything one open of a document yields about its references.
        /// </summary>
        internal sealed class ReferenceReadResult
        {
            public ReferenceReadResult(
                ExternalReferenceRead external,
                IReadOnlyList<DrawingViewReference>? viewReferences,
                CommandResult? failure)
            {
                External = external;
                ViewReferences = viewReferences;
                Failure = failure;
            }

            /// <summary>The flat reference list, and whether it was answered.</summary>
            public ExternalReferenceRead External { get; }

            /// <summary>
            /// Per-view models and configurations. Null for anything that is not a drawing, and for a
            /// drawing whose views this Document Manager version cannot read.
            /// </summary>
            public IReadOnlyList<DrawingViewReference>? ViewReferences { get; }

            /// <summary>Set when the document could not be opened at all.</summary>
            public CommandResult? Failure { get; }
        }

        /// <summary>
        /// Open a document read-only, read everything the callers need from it, and close it again.
        ///
        /// One open serves both reads because a drawing here can be 79 MB, and the view read needs the
        /// resolved reference paths anyway to turn ISwDMView.ReferencedDocument back into a full path.
        /// </summary>
        /// <param name="filters">
        /// Overrides the reference-resolution bitmask. Production never passes this; the test suite
        /// does, so it can prove that the wrong bitmask still returns nothing and the right one does
        /// not - the regression that the original defect needed.
        /// </param>
        internal ReferenceReadResult ReadReferences(string filePath, SwDmSearchFilter? filters = null)
        {
            if (!Initialize() || _dmApp == null)
            {
                return Failed(new CommandResult
                {
                    Success = false,
                    Error = _initError ?? "Document Manager not available",
                });
            }

            if (!File.Exists(filePath))
                return Failed(new CommandResult { Success = false, Error = $"File not found: {filePath}" });

            object? doc = null;
            try
            {
                doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                {
                    return Failed(new CommandResult
                    {
                        Success = false,
                        Error = $"Failed to open file: {DescribeOpenError(openError)}",
                    });
                }

                var searchOpt = CreateReferenceSearchOption(new[] { Path.GetDirectoryName(filePath) }, filters);
                if (searchOpt == null)
                {
                    return new ReferenceReadResult(
                        ExternalReferenceRead.Unavailable("Document Manager would not create a search option"),
                        null,
                        null);
                }

                var external = ReadExternalReferences(doc, searchOpt);

                IReadOnlyList<DrawingViewReference>? views = null;
                if (Path.GetExtension(filePath).Equals(".slddrw", StringComparison.OrdinalIgnoreCase))
                {
                    views = ReadDrawingViewReferences(
                        doc,
                        filePath,
                        external.References.Select(r => r.Path).ToArray());
                }

                return new ReferenceReadResult(external, views, null);
            }
            catch (Exception ex)
            {
                return Failed(new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() });
            }
            finally
            {
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                    LogDocClose(filePath);
                }
            }
        }

        private static ReferenceReadResult Failed(CommandResult failure) =>
            new ReferenceReadResult(
                ExternalReferenceRead.Unavailable(failure.Error ?? "unknown failure"),
                null,
                failure);

        #region External references

        /// <summary>
        /// Read a document's external references, preferring GetAllExternalReferences5 where the
        /// interop declares it, then 4, then the original single-argument form.
        ///
        /// Reflection is required throughout because the search option object's runtime type does not
        /// match the declared SwDMSearchOption parameter, which makes dynamic binding fail.
        ///
        /// Callers must invoke this before ISwDMDocument.ReplaceReference; the replacement is a silent
        /// no-op unless the reference list has been resolved on the same document instance.
        /// </summary>
        internal ExternalReferenceRead ReadExternalReferences(object doc, object searchOpt)
        {
            var failures = new List<string>();

            // 5 and 4 differ only in a trailing out-parameter, and both report broken references in
            // the second slot, so one loop covers them. Highest version wins.
            foreach (var arity in new[] { 5, 4 })
            {
                var attempt = TryVersionedReferenceRead(doc, searchOpt, arity, failures);
                if (attempt == null) continue;
                if (attempt.References.Count > 0) return attempt;

                // An empty list from the modern call is a real answer, but it is also exactly what a
                // misconfigured search option produces. The legacy call uses the same option object,
                // so if it finds something the modern one did not, the modern one was wrong.
                var legacy = TryLegacyReferenceRead(doc, searchOpt, failures);
                return legacy != null && legacy.References.Count > 0 ? legacy : attempt;
            }

            var fallback = TryLegacyReferenceRead(doc, searchOpt, failures);
            if (fallback != null) return fallback;

            return ExternalReferenceRead.Unavailable(
                failures.Count > 0
                    ? string.Join("; ", failures)
                    : "no GetAllExternalReferences entry point is available on this Document Manager version");
        }

        /// <summary>
        /// Invoke GetAllExternalReferences4 or GetAllExternalReferences5 on the highest interface the
        /// document implements, returning null when no interface declares it or the call threw.
        /// </summary>
        private ExternalReferenceRead? TryVersionedReferenceRead(
            object doc,
            object searchOpt,
            int arity,
            ICollection<string> failures)
        {
            var methodName = $"GetAllExternalReferences{arity}";
            var lowestInterface = arity >= 5 ? FirstInterfaceWithReferences5 : FirstInterfaceWithReferences4;

            for (var version = HighestProbedDocumentInterface; version >= lowestInterface; version--)
            {
                var interfaceName = $"ISwDMDocument{version}";
                var interfaceType = GetDmType(interfaceName);
                var method = interfaceType?.GetMethod(methodName);
                if (interfaceType == null || method == null) continue;
                if (!interfaceType.IsInstanceOfType(doc)) continue;

                // (searchOpt, out brokenRefVar, out isVirtual, out timeStamp[, out importedPaths])
                var parameters = new object?[method.GetParameters().Length];
                parameters[0] = searchOpt;

                try
                {
                    var paths = method.Invoke(doc, parameters) as string[] ?? Array.Empty<string>();
                    var broken = ReadBrokenFlags(parameters.Length > 1 ? parameters[1] : null, paths.Length);
                    var references = BuildReferenceList(paths, broken);

                    Console.Error.WriteLine(
                        $"[DM-API] {methodName} via {interfaceName}: {references.Count} refs, " +
                        $"{references.Count(r => r.IsBroken)} broken");

                    return ExternalReferenceRead.Resolved(references, $"{methodName}/{interfaceName}");
                }
                catch (Exception ex)
                {
                    var message = ex.InnerException?.Message ?? ex.Message;
                    failures.Add($"{methodName} via {interfaceName}: {message}");
                    Console.Error.WriteLine($"[DM-API] {methodName} via {interfaceName} failed: {message}");
                    return null;
                }
            }

            return null;
        }

        /// <summary>
        /// Invoke the original single-argument GetAllExternalReferences, which reports no broken-status
        /// at all, so every reference it returns is recorded as resolved.
        /// </summary>
        private static ExternalReferenceRead? TryLegacyReferenceRead(
            object doc,
            object searchOpt,
            ICollection<string> failures)
        {
            var method = doc.GetType().GetMethod("GetAllExternalReferences");
            if (method == null) return null;

            try
            {
                var paths = method.Invoke(doc, new[] { searchOpt }) as string[] ?? Array.Empty<string>();
                var references = BuildReferenceList(paths, Array.Empty<bool>());
                Console.Error.WriteLine($"[DM-API] GetAllExternalReferences: {references.Count} refs");
                return ExternalReferenceRead.Resolved(references, "GetAllExternalReferences");
            }
            catch (Exception ex)
            {
                var message = ex.InnerException?.Message ?? ex.Message;
                failures.Add($"GetAllExternalReferences: {message}");
                Console.Error.WriteLine($"[DM-API] GetAllExternalReferences failed: {message}");
                return null;
            }
        }

        /// <summary>
        /// Pair each returned path with its broken flag, dropping blanks and duplicates.
        /// Exposed for the test suite, which can build the inputs without a Document Manager licence.
        /// </summary>
        internal static IReadOnlyList<ExternalReference> BuildReferenceList(
            IReadOnlyList<string> paths,
            IReadOnlyList<bool> brokenFlags)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var references = new List<ExternalReference>(paths.Count);

            for (var i = 0; i < paths.Count; i++)
            {
                var path = paths[i];
                if (string.IsNullOrWhiteSpace(path) || !seen.Add(path)) continue;
                references.Add(new ExternalReference(path, i < brokenFlags.Count && brokenFlags[i]));
            }

            return references;
        }

        /// <summary>
        /// Decode the brokenRefVar out-parameter, which Document Manager hands back as a VARIANT
        /// holding one flag per returned reference.
        ///
        /// Exposed for the test suite. Anything that is not a usable array of flags reads as "nothing
        /// is known to be broken" rather than "everything is fine": the caller still gets its
        /// references, and a wrong shape here must not invent breakage.
        /// </summary>
        internal static IReadOnlyList<bool> ReadBrokenFlags(object? brokenRefVar, int referenceCount)
        {
            if (brokenRefVar == null || referenceCount == 0) return Array.Empty<bool>();

            if (brokenRefVar is bool single)
                return referenceCount == 1 ? new[] { single } : Array.Empty<bool>();

            if (!(brokenRefVar is Array array)) return Array.Empty<bool>();

            var flags = new bool[Math.Min(array.Length, referenceCount)];
            for (var i = 0; i < flags.Length; i++)
            {
                var value = array.GetValue(i);
                try
                {
                    flags[i] = value != null && Convert.ToBoolean(value, System.Globalization.CultureInfo.InvariantCulture);
                }
                catch (Exception ex) when (ex is FormatException || ex is InvalidCastException || ex is OverflowException)
                {
                    flags[i] = false;
                }
            }

            return flags;
        }

        #endregion

        #region Drawing views

        /// <summary>
        /// Read a drawing's referenced models and their configurations from its views, headlessly.
        ///
        /// Emits the same shape SolidWorksAPI.GetExternalReferences produces for drawings, so the
        /// caller cannot tell whether SolidWorks or Document Manager answered.
        /// </summary>
        public CommandResult GetDrawingViewReferences(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            var read = ReadReferences(filePath!);
            if (read.Failure != null) return read.Failure;

            if (read.ViewReferences == null)
                return UnresolvedReferences(filePath!, "Document Manager could not read this drawing's views");

            return new CommandResult
            {
                Success = true,
                Data = new
                {
                    filePath,
                    references = read.ViewReferences.Select(DescribeDrawingViewReference).ToList(),
                    count = read.ViewReferences.Count,
                    resolved = true,
                    source = "documentManagerViews",
                },
            };
        }

        /// <summary>
        /// Group an already-open drawing's views by the model each refers to, collecting the distinct
        /// configurations shown of it.
        /// </summary>
        /// <param name="resolvedReferencePaths">
        /// Full paths from GetAllExternalReferences on the same document. ISwDMView.ReferencedDocument
        /// is a bare filename, so these are what turn it back into a path.
        /// </param>
        /// <returns>Null when this Document Manager version cannot read views at all.</returns>
        internal IReadOnlyList<DrawingViewReference>? ReadDrawingViewReferences(
            object doc,
            string drawingPath,
            IReadOnlyCollection<string> resolvedReferencePaths)
        {
            var views = InvokeGetViews(doc);
            if (views == null) return null;

            var viewType = GetDmType("ISwDMView");
            if (viewType == null)
            {
                Console.Error.WriteLine("[DM-API] ISwDMView is not present in the Document Manager interop");
                return null;
            }

            // Insertion-ordered so the first view's model stays first, which is what consumers that
            // take references[0] as "the parent model" depend on.
            var pathOrder = new List<string>();
            var configurationsByPath = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

            foreach (var view in views)
            {
                var referencedDocument = ReadViewString(viewType, view, "ReferencedDocument");
                if (string.IsNullOrWhiteSpace(referencedDocument)) continue;

                var path = ResolveReferencedDocumentPath(referencedDocument!, drawingPath, resolvedReferencePaths);
                if (!configurationsByPath.TryGetValue(path, out var configurations))
                {
                    configurations = new List<string>();
                    configurationsByPath[path] = configurations;
                    pathOrder.Add(path);
                }

                var configuration = ReadViewString(viewType, view, "ReferencedConfiguration");
                if (!string.IsNullOrWhiteSpace(configuration) && !configurations.Contains(configuration!))
                    configurations.Add(configuration!);
            }

            return pathOrder
                .Select(path => new DrawingViewReference(path, configurationsByPath[path]))
                .ToList();
        }

        /// <summary>
        /// Turn ISwDMView.ReferencedDocument into a full path.
        ///
        /// It returns a bare filename with a lowercase extension - measured, not assumed - so the
        /// path has to come from somewhere else. The reference list Document Manager resolved on the
        /// same document is the best source because it went through the configured search paths; the
        /// drawing's own folder is the fallback, and matches how these files are laid out in a vault.
        ///
        /// Static and pure so the test suite can exercise it without a Document Manager licence.
        /// Matching is case-insensitive: REGRESSION-TEST-SCREW carries a part and a drawing whose
        /// names differ only in the case of one letter.
        /// </summary>
        internal static string ResolveReferencedDocumentPath(
            string referencedDocument,
            string drawingPath,
            IEnumerable<string> candidatePaths)
        {
            if (Path.IsPathRooted(referencedDocument)) return referencedDocument;

            var fileName = Path.GetFileName(referencedDocument);

            foreach (var candidate in candidatePaths)
            {
                if (string.IsNullOrWhiteSpace(candidate)) continue;
                if (string.Equals(Path.GetFileName(candidate), fileName, StringComparison.OrdinalIgnoreCase))
                    return candidate;
            }

            var drawingFolder = Path.GetDirectoryName(drawingPath);
            return string.IsNullOrEmpty(drawingFolder)
                ? referencedDocument
                : Path.Combine(drawingFolder!, fileName);
        }

        /// <summary>
        /// Invoke ISwDMDocument10.GetViews on the highest interface the document implements.
        /// Returns null when no interface declares it or the call threw.
        /// </summary>
        private object[]? InvokeGetViews(object doc)
        {
            for (var version = HighestProbedDocumentInterface; version >= FirstInterfaceWithViews; version--)
            {
                var interfaceType = GetDmType($"ISwDMDocument{version}");
                var method = interfaceType?.GetMethod("GetViews");
                if (interfaceType == null || method == null) continue;
                if (!interfaceType.IsInstanceOfType(doc)) continue;

                try
                {
                    return method.Invoke(doc, null) as object[] ?? Array.Empty<object>();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(
                        $"[DM-API] GetViews via ISwDMDocument{version} failed: {ex.InnerException?.Message ?? ex.Message}");
                    return null;
                }
            }

            return null;
        }

        /// <summary>
        /// Read one ISwDMView string property.
        ///
        /// GetViews hands back raw System.__ComObject instances with no interface applied, so dynamic
        /// dispatch fails with "does not contain a definition for 'ReferencedConfiguration'". The
        /// properties have to be read through the ISwDMView type from the loaded assembly.
        /// </summary>
        private static string? ReadViewString(Type viewType, object view, string propertyName)
        {
            try
            {
                var property = viewType.GetProperty(propertyName);
                if (property != null) return property.GetValue(view) as string;

                var getter = viewType.GetMethod($"get_{propertyName}");
                return getter?.Invoke(view, null) as string;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[DM-API] ISwDMView.{propertyName} failed: {ex.InnerException?.Message ?? ex.Message}");
                return null;
            }
        }

        #endregion

        #region Shared shaping

        /// <summary>
        /// The wire code for "this read was not answered", as distinct from "this file has no
        /// references". Program.cs escalates on it and only reports it to the app once every tier
        /// has declined.
        /// </summary>
        public const string ReferencesUnresolvedCode = "REFERENCES_UNRESOLVED";

        /// <summary>
        /// Report that Document Manager could not answer, carrying why. Never reported as an empty
        /// reference list: a caller that records "no references" for a file that has some corrupts
        /// the reverse lookup, and that is exactly what the wrong search-filter bitmask did.
        /// </summary>
        private static CommandResult UnresolvedReferences(string filePath, string detail)
        {
            Console.Error.WriteLine($"[DM-API] References unresolved for {Path.GetFileName(filePath)}: {detail}");
            return new CommandResult
            {
                Success = false,
                Error = ReferencesUnresolvedCode,
                ErrorCode = ReferencesUnresolvedCode,
                Data = new { filePath, resolved = false, message = detail },
            };
        }

        /// <summary>The wire shape for one drawing-view reference.</summary>
        private static object DescribeDrawingViewReference(DrawingViewReference reference) => new
        {
            path = reference.Path,
            fileName = reference.FileName,
            // Kept for wire compatibility with the SolidWorks traversal, which also does not stat.
            exists = true,
            fileType = reference.FileType,
            configuration = reference.Configuration,
            configurations = reference.Configurations.ToArray(),
        };

        /// <summary>The wire shape for one plain external reference, which carries no configuration.</summary>
        private static object DescribeExternalReference(ExternalReference reference) => new
        {
            path = reference.Path,
            fileName = Path.GetFileName(reference.Path),
            exists = true,
            fileType = ClassifyFileType(reference.Path),
            broken = reference.IsBroken,
        };

        /// <summary>
        /// The file-type label the app's reference consumers switch on.
        /// Exposed for the test suite.
        /// </summary>
        internal static string ClassifyFileType(string path) =>
            Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".sldprt" => "Part",
                ".sldasm" => "Assembly",
                ".slddrw" => "Drawing",
                _ => "Other",
            };

        #endregion
    }
}
