using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;

using Newtonsoft.Json;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Standalone diagnostic that answers one question with evidence instead of assumption:
    /// can the Document Manager API write configuration-level custom properties, and if not, why not?
    ///
    /// The production write path discards every signal the API returns - AddCustomProperty's bool,
    /// Save()'s SwDmDocumentSaveError - and then reports success unconditionally. That makes the
    /// existing "DM silently fails for config-level writes" claim unfalsifiable from logs alone.
    /// This probe captures every return value, writes to a backed-up copy, re-reads through a
    /// completely fresh Document Manager application handle, and cross-checks the file hash so a
    /// verdict does not depend on the same layer that performed the write.
    ///
    /// It never touches SolidWorksAPI, never creates a SldWorks.Application, and therefore cannot
    /// cause a SolidWorks window to appear.
    /// </summary>
    public static class DmWriteProbe
    {
        /// <summary>
        /// Whatever production currently passes to AddCustomProperty. Read from the shared constant
        /// rather than repeated here, so the probe measures the shipping code and not a copy of it.
        /// </summary>
        private static readonly int ProductionInfoTypeValue = (int)SwDmConstants.CustomPropertyTextType;

        /// <summary>swDmCustomInfoText, the value the enum defines for a text property.</summary>
        private static readonly int DocumentedTextInfoTypeValue = (int)SwDmCustomInfoType.Text;

        private const string ProbePropertyPrefix = "BluePLM_Probe_";

        /// <summary>Value written by every probe, unique per run so a stale value cannot pass.</summary>
        private static readonly string ProbeStamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);

        #region Entry point

        public static int Run(ProbeOptions options)
        {
            var report = new ProbeReport { FilePath = options.FilePath, WriteMode = options.AllowWrite };

            try
            {
                var allowedRoot = RegressionFixtureGuard.ResolveAllowedRoot();

                if (!File.Exists(options.FilePath))
                {
                    Fail(report, $"File not found: {options.FilePath}");
                    return Emit(report);
                }

                // Everything that touches the fixture folder lives behind this one check, --allow-write
                // included. The sweep used to run above it, for every invocation: a plain --dm-probe,
                // documented as read-only, deleted matching files throughout the live vault before it
                // read anything. A diagnostic whose stated contract is not the one it keeps is worse
                // than no diagnostic.
                if (options.AllowWrite)
                {
                    if (!RegressionFixtureGuard.IsInside(options.FilePath, allowedRoot))
                    {
                        Fail(report, $"Refusing to write: {RegressionFixtureGuard.DescribeRefusal(options.FilePath, allowedRoot)}");
                        return Emit(report);
                    }

                    // A previous run may have been killed mid-write, and the only thing that can
                    // finish its cleanup is the next run that is allowed to write.
                    if (!RunPreflightSweep(allowedRoot, report)) return Emit(report);
                }
                else
                {
                    Section("Pre-flight (fixture folder)");
                    Line($"Root: {allowedRoot}");
                    Line("  read-only run: nothing under the root is read, moved, restored or deleted.");
                }

                // Reported before the license check: knowing which interop DLLs exist and what state
                // the file is in is the most useful output when nothing else can run.
                ReportEnvironment(report, options.FilePath);

                if (string.IsNullOrEmpty(options.LicenseKey))
                {
                    Fail(report, "No Document Manager license key. Pass --dm-license <key>.");
                    return Emit(report);
                }

                using (var dm = new DmSession(options.LicenseKey!))
                {
                    if (!dm.TryInitialize(out var initError))
                    {
                        Fail(report, $"Document Manager init failed: {initError}");
                        return Emit(report);
                    }

                    report.DmAssemblyPath = dm.AssemblyPath;
                    report.DmAssemblyVersion = DescribeAssemblyVersion(dm.AssemblyPath);
                    Section("Document Manager");
                    Line($"Loaded interop : {dm.AssemblyPath}");
                    Line($"Interop version: {report.DmAssemblyVersion}");

                    if (options.ProbeReferences)
                    {
                        ProbeReferenceFilters(dm, options, report);
                        return Emit(report);
                    }

                    if (!ReadInventory(dm, options, report)) return Emit(report);

                    if (!options.AllowWrite)
                    {
                        Section("Result");
                        Line("Read-only mode. Re-run with --allow-write to exercise the write path.");
                        report.Verdict = "READ_ONLY_MODE";
                        return Emit(report);
                    }

                    RunWriteCycle(dm, options, report);
                }
            }
            catch (Exception ex)
            {
                Fail(report, $"Unhandled: {ex.Message}");
                report.Detail = ex.ToString();
            }

            return Emit(report);
        }

        #endregion

        #region Pre-flight

        /// <summary>
        /// Restore anything an interrupted run left behind and clear out SolidWorks leftovers.
        /// </summary>
        /// <returns>False when the folder could not be cleaned, which makes running unsafe.</returns>
        private static bool RunPreflightSweep(string allowedRoot, ProbeReport report)
        {
            var sweep = FixtureSweeper.Sweep(allowedRoot);
            report.PreflightSweep = sweep;

            Section("Pre-flight (fixture folder)");
            Line($"Root: {allowedRoot}");

            if (sweep.InterruptedRunDetected)
                Line("A PREVIOUS RUN WAS INTERRUPTED: backups were found next to fixtures it had already modified.");

            foreach (var restored in sweep.Restored) Line($"  restored: {restored}");
            foreach (var deleted in sweep.Deleted) Line($"  deleted leftover: {deleted}");
            foreach (var failure in sweep.Failures) Line($"  FAILED: {failure}");

            if (sweep.Note != null) Line($"  {sweep.Note}");
            if (!sweep.ActedOnAnything && sweep.Note == null) Line("  clean; nothing to undo");

            if (sweep.IsClean) return true;

            Fail(report, $"The fixture folder could not be cleaned: {string.Join(" | ", sweep.Failures)}");
            return false;
        }

        #endregion

        #region Environment

        private static void ReportEnvironment(ProbeReport report, string filePath)
        {
            Section("Environment");

            var candidates = SolidWorksComRegistry.GetDocumentManagerDllCandidates().ToList();
            Line($"Registry-derived interop candidates: {candidates.Count}");
            foreach (var candidate in candidates)
            {
                var marker = File.Exists(candidate) ? "present" : "missing";
                Line($"  [{marker}] {candidate}   {DescribeAssemblyVersion(candidate)}");
                report.InteropCandidates.Add(new InteropCandidate
                {
                    Path = candidate,
                    Exists = File.Exists(candidate),
                    Version = DescribeAssemblyVersion(candidate),
                });
            }

            var info = new FileInfo(filePath);
            report.FileSizeBytes = info.Length;
            report.FileLastWriteUtc = info.LastWriteTimeUtc;
            report.FileWasReadOnly = info.IsReadOnly;

            Line($"Fixture        : {info.FullName}");
            Line($"Size / modified: {info.Length:N0} bytes / {info.LastWriteTimeUtc:u}");
            Line($"Read-only attr : {info.IsReadOnly}");
            Line($"Exclusive lock : {(CanOpenExclusively(filePath) ? "available (no other process holds the file)" : "UNAVAILABLE - another process has it open")}");
        }

        /// <summary>
        /// Prove no other process holds the file without touching COM. A running SolidWorks with the
        /// document open keeps a share-denying handle, so this is a UI-free substitute for a ROT probe.
        /// </summary>
        private static bool CanOpenExclusively(string filePath)
        {
            try
            {
                using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.None);
                return true;
            }
            catch (IOException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static string DescribeAssemblyVersion(string? path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return "n/a";
            try
            {
                var version = System.Diagnostics.FileVersionInfo.GetVersionInfo(path!);
                return version.FileVersion ?? "unknown";
            }
            catch (Exception ex)
            {
                return $"unreadable ({ex.Message})";
            }
        }

        #endregion

        #region Inventory

        private static bool ReadInventory(DmSession dm, ProbeOptions options, ProbeReport report)
        {
            Section("Baseline (read-only open)");

            var doc = dm.OpenDocument(options.FilePath, readOnly: true, out var openError);
            if (doc == null)
            {
                Fail(report, $"Read-only open failed: {DescribeOpenError(openError)}");
                return false;
            }

            try
            {
                dynamic dynDoc = doc;
                var infoTypeDefault = dm.MakeCustomInfoTextEnum(0);

                report.FileLevelProperties = ReadPropertyBag(doc, infoTypeDefault);
                Line($"File-level properties: {report.FileLevelProperties.Count}");
                foreach (var kvp in report.FileLevelProperties.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
                    Line($"  {kvp.Key} = {Truncate(kvp.Value)}");

                var configNames = ReadConfigurationNames(dynDoc);
                report.ConfigurationCount = configNames.Length;
                report.ConfigurationNames.AddRange(configNames);
                Line($"Configurations: {configNames.Length}");
                Line($"  {string.Join(" | ", configNames)}");

                report.TargetConfiguration = ResolveTargetConfiguration(configNames, options.Configuration);
                if (report.TargetConfiguration == null)
                {
                    // A drawing has no configurations at all, and the file-level probes are the ones
                    // that matter for it: a title block's $PRP: reference resolves against the file
                    // scope. Refusing to run would leave the document type the whole empty-property
                    // decision is about as the one type never measured.
                    if (options.Configuration != null)
                    {
                        Fail(report, $"Configuration '{options.Configuration}' not found. Available: {string.Join(", ", configNames)}");
                        return false;
                    }

                    Line("No configurations; file-level probes only.");
                    return true;
                }

                Line($"Target config : {report.TargetConfiguration}");

                var config = dynDoc.ConfigurationManager.GetConfigurationByName(report.TargetConfiguration);
                if (config == null)
                {
                    Fail(report, $"GetConfigurationByName returned null for '{report.TargetConfiguration}'");
                    return false;
                }

                report.ConfigLevelProperties = ReadPropertyBag((object)config, infoTypeDefault);
                Line($"Config-level properties on '{report.TargetConfiguration}': {report.ConfigLevelProperties.Count}");
                foreach (var kvp in report.ConfigLevelProperties.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
                    Line($"  {kvp.Key} = {Truncate(kvp.Value)}");

                return true;
            }
            finally
            {
                TryClose(doc);
            }
        }

        /// <summary>
        /// A drawing's ConfigurationManager throws E_FAIL out of GetConfigurationNames rather than
        /// returning an empty array, so "this document has no configurations" arrives as an
        /// exception and has to be read as an answer.
        /// </summary>
        private static string[] ReadConfigurationNames(dynamic doc)
        {
            try
            {
                return (string[]?)doc.ConfigurationManager.GetConfigurationNames() ?? Array.Empty<string>();
            }
            catch (Exception ex)
            {
                Line($"  (GetConfigurationNames failed, treating the document as having none: {ex.InnerException?.Message ?? ex.Message})");
                return Array.Empty<string>();
            }
        }

        /// <summary>
        /// Prefer an explicitly requested configuration, then one that already carries properties
        /// (a config with existing values exercises SetCustomProperty's update path), else the first.
        /// </summary>
        private static string? ResolveTargetConfiguration(string[] configNames, string? requested)
        {
            if (configNames.Length == 0) return null;
            if (requested != null)
            {
                return configNames.FirstOrDefault(c => string.Equals(c, requested, StringComparison.OrdinalIgnoreCase));
            }
            return configNames[0];
        }

        /// <summary>
        /// Read every custom property from a document or configuration.
        ///
        /// GetCustomProperty has an out parameter typed as SwDmCustomInfoType. Dynamic dispatch cannot
        /// bind it - the runtime reports "no best overloaded method match" - so the call goes through
        /// reflection with a properly constructed enum instance, matching what ReadProperties does in
        /// DocumentManagerAPI.
        /// </summary>
        private static Dictionary<string, string> ReadPropertyBag(object owner, object infoTypeDefault)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                dynamic dynOwner = owner;
                var names = (string[]?)dynOwner.GetCustomPropertyNames() ?? Array.Empty<string>();

                var ownerType = owner.GetType();
                var getMethod = ownerType.GetMethod("ISwDMDocument_GetCustomProperty")
                    ?? ownerType.GetMethod("ISwDMConfiguration_GetCustomProperty")
                    ?? ownerType.GetMethod("GetCustomProperty");

                foreach (var name in names)
                {
                    if (getMethod == null)
                    {
                        result[name] = "<GetCustomProperty not found>";
                        continue;
                    }

                    try
                    {
                        var parameters = new object[] { name, infoTypeDefault };
                        result[name] = getMethod.Invoke(owner, parameters)?.ToString() ?? string.Empty;
                    }
                    catch (Exception ex)
                    {
                        result[name] = $"<read failed: {ex.InnerException?.Message ?? ex.Message}>";
                    }
                }
            }
            catch (Exception ex)
            {
                Line($"  (property enumeration failed: {ex.Message})");
            }
            return result;
        }

        #endregion

        #region Reference filter comparison

        /// <summary>
        /// Resolve external references under several SearchFilters bitmasks and report how many each
        /// finds. Read-only. This isolates whether an empty reference list means "no references" or
        /// "the search was never told to look for external references".
        /// </summary>
        private static void ProbeReferenceFilters(DmSession dm, ProbeOptions options, ProbeReport report)
        {
            Section("Reference search filters");

            var doc = dm.OpenDocument(options.FilePath, readOnly: true, out var openError);
            if (doc == null)
            {
                Fail(report, $"Read-only open failed: {DescribeOpenError(openError)}");
                return;
            }

            try
            {
                var folder = Path.GetDirectoryName(options.FilePath);

                foreach (var (filters, label, isProduction) in ReferenceFilterCases())
                {
                    var trial = new ReferenceTrial { Filters = filters, Label = label, IsProduction = isProduction };
                    try
                    {
                        var searchOpt = dm.CreateSearchOption(filters, folder);
                        if (searchOpt == null)
                        {
                            trial.Note = "could not create search option";
                        }
                        else
                        {
                            var refs = dm.GetAllExternalReferences(doc, searchOpt);
                            trial.ReferenceCount = refs?.Length ?? 0;
                            trial.References.AddRange((refs ?? Array.Empty<string>()).Select(Path.GetFileName));
                        }
                    }
                    catch (Exception ex)
                    {
                        trial.Note = $"threw: {ex.InnerException?.Message ?? ex.Message}";
                    }

                    report.ReferenceTrials.Add(trial);
                    Line($"  filters={filters,-4} {label,-58} -> {trial.ReferenceCount} refs {trial.Note}");
                    if (trial.References.Count > 0)
                        Line($"      {string.Join(", ", trial.References)}");
                }

                ProbeDrawingViews(dm, doc, report);
            }
            finally
            {
                TryClose(doc);
            }

            var production = report.ReferenceTrials.FirstOrDefault(t => t.IsProduction);
            var withoutExternalBit = report.ReferenceTrials.FirstOrDefault(t => t.Filters == TypeFlagsOnlyFilters);
            var withExternalBit = report.ReferenceTrials.FirstOrDefault(t => t.Filters == ExternalReferenceOnlyFilters);

            if ((production?.ReferenceCount ?? 0) > 0)
                report.Verdict = "REFERENCES_RESOLVE";
            else if ((withoutExternalBit?.ReferenceCount ?? 0) == 0 && (withExternalBit?.ReferenceCount ?? 0) > 0)
                report.Verdict = "REFERENCES_BROKEN_BY_SEARCH_FILTER";
            else
                report.Verdict = "REFERENCE_FILTERS_INCONCLUSIVE";

            Line($"Verdict: {report.Verdict}");
        }

        /// <summary>Document TYPE flags with no behaviour flag: what DocumentManagerAPI used to pass.</summary>
        private const int TypeFlagsOnlyFilters = 15;

        /// <summary>SwDmSearchExternalReference on its own.</summary>
        private const int ExternalReferenceOnlyFilters = 16;

        /// <summary>
        /// The two production values are read from SwDmConstants, so this comparison reports what the
        /// service does rather than what it did when the probe was written. The fixed rows are the
        /// controls: type flags with no ExternalReference bit, and that bit on its own.
        /// </summary>
        private static IEnumerable<(int Filters, string Label, bool IsProduction)> ReferenceFilterCases()
        {
            yield return ((int)SwDmConstants.ReferenceResolutionFilters,
                $"{SwDmConstants.ReferenceResolutionFilters} (production, reference resolution)", true);
            yield return ((int)SwDmConstants.ComponentSearchFilters,
                $"{SwDmConstants.ComponentSearchFilters} (production, component search)", false);
            yield return (TypeFlagsOnlyFilters, "Subfolders|ForPart|ForDrawing|ForAssembly (no ExternalReference bit)", false);
            yield return (ExternalReferenceOnlyFilters, "ExternalReference only", false);
        }

        /// <summary>
        /// Read drawing views headlessly. If ReferencedConfiguration is populated here, the per-view
        /// configuration does not require the SolidWorks COM traversal the app performs today.
        /// </summary>
        private static void ProbeDrawingViews(DmSession dm, object doc, ProbeReport report)
        {
            Section("Drawing views via ISwDMDocument10.GetViews");

            try
            {
                var views = dm.GetViews(doc);
                if (views == null)
                {
                    Line("GetViews unavailable or returned null");
                    return;
                }

                Line($"Views: {views.Length}");

                // GetViews hands back raw __ComObject instances with no interface applied, so dynamic
                // dispatch cannot find the members. The properties have to be read off ISwDMView itself.
                var viewType = dm.ResolveType("ISwDMView");
                if (viewType == null)
                {
                    Line("ISwDMView type not found in the interop");
                    return;
                }

                foreach (var view in views)
                {
                    var entry = new DrawingViewInfo
                    {
                        Name = ReadViewProperty(viewType, view, "Name"),
                        ReferencedDocument = ReadViewProperty(viewType, view, "ReferencedDocument"),
                        ReferencedConfiguration = ReadViewProperty(viewType, view, "ReferencedConfiguration"),
                        SheetName = ReadViewProperty(viewType, view, "SheetName"),
                    };
                    report.DrawingViews.Add(entry);
                    Line($"  {entry.Name} | sheet={entry.SheetName} | doc={entry.ReferencedDocument} | config={entry.ReferencedConfiguration}");
                }
            }
            catch (Exception ex)
            {
                Line($"GetViews failed: {ex.InnerException?.Message ?? ex.Message}");
            }
        }

        private static string ReadViewProperty(Type viewType, object view, string propertyName)
        {
            try
            {
                var property = viewType.GetProperty(propertyName);
                if (property != null) return property.GetValue(view)?.ToString() ?? string.Empty;

                var getter = viewType.GetMethod($"get_{propertyName}");
                return getter?.Invoke(view, null)?.ToString() ?? "<not found>";
            }
            catch (Exception ex)
            {
                return $"<{ex.InnerException?.Message ?? ex.Message}>";
            }
        }

        #endregion

        #region Write cycle

        private static void RunWriteCycle(DmSession dm, ProbeOptions options, ProbeReport report)
        {
            Section("Backup");
            using var backup = FixtureBackup.Create(options.FilePath, RegressionFixtureGuard.ResolveAllowedRoot());
            report.BackupPath = backup.BackupPath;
            report.HashBeforeWrite = backup.OriginalHash;
            Line($"Backup    : {backup.BackupPath}");
            Line($"SHA-256   : {backup.OriginalHash}");
            Line($"Read-only : {backup.WasReadOnly} (restored along with the bytes)");

            try
            {
                PrepareWritableFlag(options, report);
                ExecuteWrites(dm, options, report);
                VerifyThroughFreshHandle(options, report);
            }
            catch (Exception ex)
            {
                Fail(report, $"Write cycle aborted: {ex.Message}");
                report.Detail = ex.ToString();
            }
            finally
            {
                RestoreFixture(backup, report);
            }

            Section("Verdict");
            report.Verdict = DetermineVerdict(report);
            report.EmptyValueVerdict = DetermineEmptyValueVerdict(report);
            foreach (var probe in report.Probes)
                Line($"  [{(probe.Verified == true ? "PASS" : probe.Verified == false ? "FAIL" : "????")}] {probe.Name}: {probe.Notes}");
            Line($"Overall    : {report.Verdict}");
            Line($"Empty value: {report.EmptyValueVerdict}");
        }

        /// <summary>
        /// The read-only file attribute is the leading suspect for silent save failures: BluePLM marks
        /// unchecked-out vault files read-only, and Save() reports that through a return code the
        /// production path throws away. --probe-readonly forces the attribute on so the code is captured.
        /// </summary>
        private static void PrepareWritableFlag(ProbeOptions options, ProbeReport report)
        {
            var info = new FileInfo(options.FilePath);
            if (options.ProbeReadOnly)
            {
                info.IsReadOnly = true;
                report.WroteWithReadOnlyAttribute = true;
                Line("Read-only attribute forced ON for this run (--probe-readonly).");
            }
            else if (info.IsReadOnly)
            {
                info.IsReadOnly = false;
                Line("Cleared the read-only attribute before writing.");
            }
        }

        private static void ExecuteWrites(DmSession dm, ProbeOptions options, ProbeReport report)
        {
            Section("Write (single open/save cycle)");

            var doc = dm.OpenDocument(options.FilePath, readOnly: false, out var openError);
            report.WriteOpenErrorCode = openError;
            report.WriteOpenError = DescribeOpenError(openError);
            Line($"Open for write: error={openError} ({report.WriteOpenError})");

            if (doc == null)
            {
                Fail(report, $"Write open failed: {report.WriteOpenError}");
                return;
            }

            try
            {
                dynamic dynDoc = doc;
                var productionInfoType = dm.MakeCustomInfoTextEnum(ProductionInfoTypeValue);
                var documentedInfoType = dm.MakeCustomInfoTextEnum(DocumentedTextInfoTypeValue);

                var existingFileProp = report.FileLevelProperties.Keys.FirstOrDefault();
                var existingConfigProp = report.ConfigLevelProperties.Keys.FirstOrDefault();

                if (existingFileProp != null)
                    report.Probes.Add(SetExisting(doc, "file-level SetCustomProperty (existing key)", existingFileProp));

                report.Probes.Add(SetNew(doc, "file-level SetCustomProperty (new key)", productionInfoType, useAdd: false, tag: "Set", ProbeVariant.NewKeyViaSet));
                report.Probes.Add(SetNew(doc, $"file-level AddCustomProperty type={ProductionInfoTypeValue} (production constant)", productionInfoType, useAdd: true, tag: "AddProd", ProbeVariant.ProductionInfoType));
                report.Probes.Add(SetNew(doc, $"file-level AddCustomProperty type={DocumentedTextInfoTypeValue} (swDmCustomInfoText)", documentedInfoType, useAdd: true, tag: "AddText", ProbeVariant.DocumentedInfoType));

                AddEmptyValueProbes(doc, "file", documentedInfoType, report);

                if (report.TargetConfiguration == null)
                {
                    Line("  (no configurations on this document; config-level probes skipped)");
                    CaptureSaveResult(doc, report);
                    return;
                }

                var config = dynDoc.ConfigurationManager.GetConfigurationByName(report.TargetConfiguration);
                if (config == null)
                {
                    Fail(report, $"GetConfigurationByName returned null for '{report.TargetConfiguration}' during write");
                }
                else
                {
                    if (existingConfigProp != null)
                        report.Probes.Add(SetExisting((object)config, "config-level SetCustomProperty (existing key)", existingConfigProp));

                    report.Probes.Add(SetNew((object)config, "config-level SetCustomProperty (new key)", productionInfoType, useAdd: false, tag: "Set", ProbeVariant.NewKeyViaSet));
                    report.Probes.Add(SetNew((object)config, $"config-level AddCustomProperty type={ProductionInfoTypeValue} (production constant)", productionInfoType, useAdd: true, tag: "AddProd", ProbeVariant.ProductionInfoType));
                    report.Probes.Add(SetNew((object)config, $"config-level AddCustomProperty type={DocumentedTextInfoTypeValue} (swDmCustomInfoText)", documentedInfoType, useAdd: true, tag: "AddText", ProbeVariant.DocumentedInfoType));

                    AddEmptyValueProbes((object)config, "config", documentedInfoType, report);
                }

                CaptureSaveResult(doc, report);
            }
            finally
            {
                TryClose(doc);
            }
        }

        private static ProbeCase SetExisting(object owner, string name, string propertyName)
        {
            var probe = new ProbeCase
            {
                Name = name,
                PropertyName = propertyName,
                Scope = name.StartsWith("config", StringComparison.OrdinalIgnoreCase) ? "config" : "file",
                Variant = ProbeVariant.ExistingKey,
                ExpectedValue = $"{ProbePropertyPrefix}{ProbeStamp}",
            };

            try
            {
                dynamic dynOwner = owner;
                dynOwner.SetCustomProperty(probe.PropertyName, probe.ExpectedValue);
                probe.CallThrew = false;
                probe.ReturnValue = "void (API returns nothing)";
                probe.Notes = "SetCustomProperty returned without throwing";
            }
            catch (Exception ex)
            {
                probe.CallThrew = true;
                probe.Notes = $"SetCustomProperty threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"  {probe.Name} [{probe.PropertyName}] -> {probe.Notes}");
            return probe;
        }

        private static ProbeCase SetNew(object owner, string name, object infoTypeEnum, bool useAdd, string tag, string variant)
        {
            var scope = name.StartsWith("config", StringComparison.OrdinalIgnoreCase) ? "Cfg" : "File";
            var probe = new ProbeCase
            {
                Name = name,
                PropertyName = $"{ProbePropertyPrefix}{scope}{tag}_{ProbeStamp}",
                Scope = scope == "Cfg" ? "config" : "file",
                Variant = variant,
                ExpectedValue = $"probe-{ProbeStamp}",
            };

            try
            {
                if (useAdd)
                {
                    var method = owner.GetType().GetMethod("AddCustomProperty")
                        ?? throw new InvalidOperationException("AddCustomProperty not found on the COM object");
                    var returned = method.Invoke(owner, new object[] { probe.PropertyName, infoTypeEnum, probe.ExpectedValue });
                    probe.ReturnValue = returned?.ToString() ?? "null";
                    probe.Notes = $"AddCustomProperty returned {probe.ReturnValue} (production discards this)";
                }
                else
                {
                    dynamic dynOwner = owner;
                    dynOwner.SetCustomProperty(probe.PropertyName, probe.ExpectedValue);
                    probe.ReturnValue = "void (API returns nothing)";
                    probe.Notes = "SetCustomProperty on a missing key returned without throwing";
                }
                probe.CallThrew = false;
            }
            catch (Exception ex)
            {
                probe.CallThrew = true;
                probe.Notes = $"threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"  {probe.Name} [{probe.PropertyName}] -> {probe.Notes}");
            return probe;
        }

        /// <summary>
        /// Can Document Manager hold a property that exists and has no value?
        ///
        /// Clearing a field in BluePLM has to leave the property in the file, because a title block
        /// linked with $PRP:"Description" renders blank against an empty property and breaks against
        /// one that is not there. The service deleted the property instead, on the strength of a code
        /// comment calling SetCustomProperty("", ...) "unreliable" - a claim no one had measured.
        ///
        /// Each route to an empty value is tried separately, because they can fail independently:
        /// emptying a property that already has a value is a different call from creating one empty.
        /// </summary>
        private static void AddEmptyValueProbes(object owner, string scope, object infoTypeEnum, ProbeReport report)
        {
            var tag = scope == "config" ? "Cfg" : "File";

            // The two halves of production's set-then-add sequence, each with an empty value.
            report.Probes.Add(EmptyAfterValue(owner, scope, tag, infoTypeEnum));
            report.Probes.Add(EmptyViaAdd(owner, scope, tag, infoTypeEnum));

            // Controls. SetCustomProperty against a name that does not exist fails for any value,
            // empty or not, which is why production follows it with AddCustomProperty; running it
            // here keeps that failure from being mistaken for one about the empty value.
            report.Probes.Add(EmptyViaSetOnMissingKey(owner, scope, tag));
            report.Probes.Add(EmptyViaSpaceThenSet(owner, scope, tag, infoTypeEnum));
        }

        /// <summary>
        /// The case the product decision is about: a property that holds a value, then the user
        /// clears the field. Seeded with a value first so this measures emptying, not creating.
        /// </summary>
        private static ProbeCase EmptyAfterValue(object owner, string scope, string tag, object infoTypeEnum)
        {
            var probe = NewEmptyProbe(scope, $"{scope}-level SetCustomProperty(\"\") over an existing value", $"{tag}EmptyOverValue");

            try
            {
                var seeded = InvokeAdd(owner, probe.PropertyName, infoTypeEnum, "seed-value");
                probe.ReturnValue = $"AddCustomProperty(seed)={seeded}";

                dynamic dynOwner = owner;
                dynOwner.SetCustomProperty(probe.PropertyName, string.Empty);
                probe.CallThrew = false;
                probe.Notes = $"seeded then SetCustomProperty(\"\") returned without throwing [{probe.ReturnValue}]";
            }
            catch (Exception ex)
            {
                probe.CallThrew = true;
                probe.Notes = $"threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"  {probe.Name} [{probe.PropertyName}] -> {probe.Notes}");
            return probe;
        }

        /// <summary>SetCustomProperty with an empty value against a name that does not exist yet.</summary>
        private static ProbeCase EmptyViaSetOnMissingKey(object owner, string scope, string tag)
        {
            var probe = NewEmptyProbe(scope, $"{scope}-level SetCustomProperty(\"\") on a missing key (control)", $"{tag}EmptySet", isControl: true);

            try
            {
                dynamic dynOwner = owner;
                dynOwner.SetCustomProperty(probe.PropertyName, string.Empty);
                probe.CallThrew = false;
                probe.ReturnValue = "void (API returns nothing)";
                probe.Notes = "SetCustomProperty(\"\") on a missing key returned without throwing";
            }
            catch (Exception ex)
            {
                probe.CallThrew = true;
                probe.Notes = $"threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"  {probe.Name} [{probe.PropertyName}] -> {probe.Notes}");
            return probe;
        }

        /// <summary>AddCustomProperty with an empty value. Its bool is the answer production needs.</summary>
        private static ProbeCase EmptyViaAdd(object owner, string scope, string tag, object infoTypeEnum)
        {
            var probe = NewEmptyProbe(scope, $"{scope}-level AddCustomProperty(\"\") on a missing key", $"{tag}EmptyAdd");

            try
            {
                var accepted = InvokeAdd(owner, probe.PropertyName, infoTypeEnum, string.Empty);
                probe.CallThrew = false;
                probe.ReturnValue = accepted.ToString();
                probe.Notes = $"AddCustomProperty returned {probe.ReturnValue}";
            }
            catch (Exception ex)
            {
                probe.CallThrew = true;
                probe.Notes = $"threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"  {probe.Name} [{probe.PropertyName}] -> {probe.Notes}");
            return probe;
        }

        /// <summary>
        /// The fallback the plan proposed in case an empty value cannot create a property: create it
        /// with a single space, then empty it. Worth measuring even when the direct routes work,
        /// because it is the only remaining option if one of them regresses.
        /// </summary>
        private static ProbeCase EmptyViaSpaceThenSet(object owner, string scope, string tag, object infoTypeEnum)
        {
            var probe = NewEmptyProbe(scope, $"{scope}-level AddCustomProperty(\" \") then SetCustomProperty(\"\") (fallback)", $"{tag}EmptySpace", isControl: true);

            try
            {
                var accepted = InvokeAdd(owner, probe.PropertyName, infoTypeEnum, " ");
                probe.ReturnValue = $"AddCustomProperty(\" \")={accepted}";

                dynamic dynOwner = owner;
                dynOwner.SetCustomProperty(probe.PropertyName, string.Empty);
                probe.CallThrew = false;
                probe.Notes = $"space-then-empty completed [{probe.ReturnValue}]";
            }
            catch (Exception ex)
            {
                probe.CallThrew = true;
                probe.Notes = $"threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"  {probe.Name} [{probe.PropertyName}] -> {probe.Notes}");
            return probe;
        }

        private static ProbeCase NewEmptyProbe(string scope, string name, string tag, bool isControl = false) => new ProbeCase
        {
            Name = name,
            PropertyName = $"{ProbePropertyPrefix}{tag}_{ProbeStamp}",
            Scope = scope,
            Variant = isControl ? ProbeVariant.EmptyValueControl : ProbeVariant.EmptyValue,
            ExpectedValue = string.Empty,
        };

        private static bool InvokeAdd(object owner, string name, object infoTypeEnum, string value)
        {
            var method = owner.GetType().GetMethod("AddCustomProperty")
                ?? throw new InvalidOperationException("AddCustomProperty not found on the COM object");
            return method.Invoke(owner, new object[] { name, infoTypeEnum, value }) is bool accepted && accepted;
        }

        private static void CaptureSaveResult(object doc, ProbeReport report)
        {
            try
            {
                var method = doc.GetType().GetMethod("Save");
                if (method == null)
                {
                    report.SaveResultCode = -1;
                    report.SaveResult = "Save method not found";
                }
                else
                {
                    var returned = method.Invoke(doc, null);
                    report.SaveResultCode = returned == null ? 0 : Convert.ToInt32(returned, CultureInfo.InvariantCulture);
                    report.SaveResult = DescribeSaveError(report.SaveResultCode);
                }
            }
            catch (Exception ex)
            {
                report.SaveResultCode = -1;
                report.SaveResult = $"Save threw: {ex.InnerException?.Message ?? ex.Message}";
            }

            Line($"Save() -> {report.SaveResultCode} ({report.SaveResult})   [production discards this value]");
        }

        #endregion

        #region Verification

        /// <summary>
        /// Re-read through a brand new Document Manager application, not the handle that performed the
        /// write. A cached document object could report values that were never persisted, so the file
        /// hash is compared too - that check is independent of Document Manager entirely.
        /// </summary>
        private static void VerifyThroughFreshHandle(ProbeOptions options, ProbeReport report)
        {
            Section("Read-back (fresh Document Manager application)");

            report.HashAfterWrite = FixtureFile.ComputeSha256(options.FilePath);
            report.FileBytesChanged = !string.Equals(report.HashBeforeWrite, report.HashAfterWrite, StringComparison.OrdinalIgnoreCase);
            Line($"SHA-256 after write: {report.HashAfterWrite}");
            Line($"File bytes changed : {report.FileBytesChanged}");

            using var verifier = new DmSession(options.LicenseKey!);
            if (!verifier.TryInitialize(out var initError))
            {
                Line($"Verifier init failed: {initError}");
                return;
            }

            var doc = verifier.OpenDocument(options.FilePath, readOnly: true, out var openError);
            if (doc == null)
            {
                Line($"Verifier open failed: {DescribeOpenError(openError)}");
                return;
            }

            try
            {
                dynamic dynDoc = doc;
                var infoTypeDefault = verifier.MakeCustomInfoTextEnum(0);
                var fileProps = ReadPropertyBag(doc, infoTypeDefault);

                var configObj = report.TargetConfiguration == null
                    ? null
                    : dynDoc.ConfigurationManager.GetConfigurationByName(report.TargetConfiguration);
                var configProps = configObj == null
                    ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    : ReadPropertyBag((object)configObj, infoTypeDefault);

                report.FileLevelAfter = fileProps;
                report.ConfigLevelAfter = configProps;

                foreach (var probe in report.Probes)
                {
                    var bag = probe.Scope == "config" ? configProps : fileProps;
                    probe.PresentAfterWrite = bag.TryGetValue(probe.PropertyName, out var actual);
                    probe.ActualValue = probe.PresentAfterWrite == true ? actual : null;
                    probe.Verified = probe.PresentAfterWrite == true &&
                        string.Equals(probe.ActualValue, probe.ExpectedValue, StringComparison.Ordinal);
                    probe.Notes += probe.Verified == true
                        ? $" | read-back OK (present, value '{probe.ActualValue}')"
                        : $" | read-back MISMATCH (expected '{probe.ExpectedValue}', got '{probe.ActualValue ?? "<absent>"}')";
                }
            }
            finally
            {
                TryClose(doc);
            }
        }

        /// <summary>
        /// Verdicts distinguish updating an existing property from creating a new one, and production's
        /// info-type constant from the documented one. Collapsing those into a single pass/fail is what
        /// made this look like a configuration-scope problem for three releases.
        /// </summary>
        private static string DetermineVerdict(ProbeReport report)
        {
            if (report.Probes.Count == 0) return "NO_PROBES_RAN";

            bool AllPassed(Func<ProbeCase, bool> selector)
            {
                var matched = report.Probes.Where(selector).ToList();
                return matched.Count > 0 && matched.All(p => p.Verified == true);
            }

            var updatesWork = AllPassed(p => p.Variant == ProbeVariant.ExistingKey);
            var createsWorkAsShipped = AllPassed(p => p.Variant == ProbeVariant.ProductionInfoType);
            var createsWorkWithTextType = AllPassed(p => p.Variant == ProbeVariant.DocumentedInfoType);

            if (updatesWork && createsWorkAsShipped) return "DM_FULLY_FUNCTIONAL";

            if (updatesWork && !createsWorkAsShipped && createsWorkWithTextType)
                return "DM_CREATE_BROKEN_BY_INFOTYPE_CONSTANT";

            if (updatesWork) return "DM_UPDATE_ONLY";

            return "DM_WRITES_NOTHING";
        }

        /// <summary>
        /// Whether Document Manager can hold a property that exists and has no value, which is what
        /// "the user cleared this field" has to look like in the file.
        ///
        /// Judged on the routes production takes only. The fallback verdict is what decides whether
        /// a workaround is needed, so it is reported rather than folded in.
        /// </summary>
        private static string DetermineEmptyValueVerdict(ProbeReport report)
        {
            var cases = report.Probes.Where(p => p.Variant == ProbeVariant.EmptyValue).ToList();
            if (cases.Count == 0) return "NO_EMPTY_PROBES_RAN";
            if (cases.All(p => p.Verified == true)) return "DM_STORES_EMPTY_PROPERTIES";

            var fallbackWorks = report.Probes
                .Any(p => p.Variant == ProbeVariant.EmptyValueControl && p.Verified == true);

            if (cases.All(p => p.PresentAfterWrite != true))
            {
                return fallbackWorks
                    ? "DM_STORES_EMPTY_PROPERTIES_ONLY_VIA_FALLBACK"
                    : "DM_CANNOT_STORE_EMPTY_PROPERTIES";
            }

            var failed = cases.Where(p => p.Verified != true).Select(p => p.Name);
            return $"DM_STORES_EMPTY_PROPERTIES_ONLY_SOMETIMES (failed: {string.Join("; ", failed)})";
        }

        /// <summary>
        /// A fixture left modified while the run reports success is the worst outcome available here,
        /// so a restore that does not complete fails the run and names the file.
        /// </summary>
        private static void RestoreFixture(FixtureBackup backup, ProbeReport report)
        {
            Section("Restore");

            var result = backup.Restore();
            report.Restored = result.Restored;
            report.RestoreMessage = result.Message;

            if (result.Restored)
                Line($"{Path.GetFileName(result.FilePath)}: {result.Message}");
            else
                Fail(report, $"RESTORE FAILED for {result.FilePath}: {result.Message}");
        }

        #endregion

        #region Helpers

        private static void TryClose(object? doc)
        {
            if (doc == null) return;
            try { ((dynamic)doc).CloseDoc(); } catch { }
        }

        private static string Truncate(string value, int max = 80)
        {
            if (value.Length <= max) return value;
            return value.Substring(0, max) + "...";
        }

        /// <summary>
        /// Decoded from SwDmDocumentOpenError as the interop actually defines it. The table in
        /// DocumentManagerAPI.DescribeOpenError is shifted from code 2 onward, so it reports a
        /// read-only file as "not a native SolidWorks file" and a missing license as "file is open
        /// in another application".
        /// </summary>
        private static string DescribeOpenError(int error) => error switch
        {
            0 => "none",
            1 => "swDmDocumentOpenErrorFail (generic failure)",
            2 => "swDmDocumentOpenErrorNonSW (not a native SolidWorks file)",
            3 => "swDmDocumentOpenErrorFileNotFound",
            4 => "swDmDocumentOpenErrorFileReadOnly",
            5 => "swDmDocumentOpenErrorNoLicense",
            6 => "swDmDocumentOpenErrorFutureVersion (saved by a newer SolidWorks than this Document Manager)",
            _ => $"error code {error}",
        };

        private static string DescribeSaveError(int error) => error switch
        {
            0 => "swDmDocumentSaveErrorNone",
            1 => "swDmDocumentSaveErrorReadOnly",
            2 => "swDmDocumentSaveErrorFail",
            _ => $"error code {error}",
        };

        private static void Section(string title)
        {
            Console.Error.WriteLine();
            Console.Error.WriteLine($"=== {title} ===");
        }

        private static void Line(string message) => Console.Error.WriteLine(message);

        private static void Fail(ProbeReport report, string message)
        {
            report.Error = message;
            report.Verdict ??= "ERROR";
            Console.Error.WriteLine($"ERROR: {message}");
        }

        private static int Emit(ProbeReport report)
        {
            Console.WriteLine(JsonConvert.SerializeObject(report, Formatting.Indented));
            return report.Error == null ? 0 : 1;
        }

        #endregion

        #region Document Manager session

        /// <summary>
        /// A self-contained Document Manager application handle. Deliberately does not reuse
        /// <see cref="DocumentManagerAPI"/>: that class swallows errors, and the probe exists to see them.
        /// It does share the interop discovery order so the DLL under test is the one production loads.
        /// </summary>
        private sealed class DmSession : IDisposable
        {
            private static readonly string[] FallbackDllSearchPaths =
            {
                @"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.swdocumentmgr.dll",
                @"C:\Program Files\SolidWorks Corp\SolidWorks\api\redist\SolidWorks.Interop.swdocumentmgr.dll",
                @"C:\Program Files (x86)\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.swdocumentmgr.dll",
                @"C:\Program Files\Common Files\SolidWorks Shared\SolidWorks.Interop.swdocumentmgr.dll",
            };

            private readonly string _licenseKey;
            private Assembly? _assembly;
            private object? _app;

            public DmSession(string licenseKey) => _licenseKey = licenseKey;

            public string? AssemblyPath { get; private set; }

            public bool TryInitialize(out string? error)
            {
                error = null;

                foreach (var path in EnumerateSearchPaths())
                {
                    if (!File.Exists(path)) continue;
                    try
                    {
                        _assembly = Assembly.LoadFrom(path);
                        AssemblyPath = path;
                        break;
                    }
                    catch (Exception ex)
                    {
                        error = $"LoadFrom({path}) failed: {ex.Message}";
                    }
                }

                if (_assembly == null)
                {
                    error ??= "SolidWorks.Interop.swdocumentmgr.dll not found";
                    return false;
                }

                var factoryType = Type.GetTypeFromProgID("SwDocumentMgr.SwDMClassFactory")
                    ?? GetDmType("SwDMClassFactory");
                if (factoryType == null)
                {
                    error = "SwDMClassFactory type not found";
                    return false;
                }

                var factory = Activator.CreateInstance(factoryType);
                if (factory == null)
                {
                    error = "Could not create SwDMClassFactory";
                    return false;
                }

                var getApp = GetDmType("ISwDMClassFactory")?.GetMethod("GetApplication")
                    ?? factoryType.GetMethod("GetApplication");
                if (getApp == null)
                {
                    error = "GetApplication method not found";
                    return false;
                }

                try
                {
                    _app = getApp.Invoke(factory, new object[] { _licenseKey });
                }
                catch (Exception ex)
                {
                    error = $"GetApplication threw: {ex.InnerException?.Message ?? ex.Message}";
                    return false;
                }

                if (_app == null)
                {
                    error = "GetApplication returned null (license key invalid or expired)";
                    return false;
                }

                return true;
            }

            public object? OpenDocument(string filePath, bool readOnly, out int error)
            {
                error = 1;
                if (_app == null) return null;

                var docTypeEnumType = GetDmType("SwDmDocumentType");
                var errorEnumType = GetDmType("SwDmDocumentOpenError");
                var getDoc = GetDmType("ISwDMApplication")?.GetMethod("GetDocument")
                    ?? _app.GetType().GetMethod("GetDocument");

                if (docTypeEnumType == null || errorEnumType == null || getDoc == null) return null;

                var docTypeValue = Path.GetExtension(filePath).ToLowerInvariant() switch
                {
                    ".sldprt" => 1,
                    ".sldasm" => 2,
                    ".slddrw" => 3,
                    _ => 0,
                };
                if (docTypeValue == 0) return null;

                var parameters = new object[]
                {
                    filePath,
                    Enum.ToObject(docTypeEnumType, docTypeValue),
                    readOnly,
                    Enum.ToObject(errorEnumType, 0),
                };

                var doc = getDoc.Invoke(_app, parameters);
                error = Convert.ToInt32(parameters[3], CultureInfo.InvariantCulture);
                return doc;
            }

            public object MakeCustomInfoTextEnum(int value)
            {
                var enumType = GetDmType("SwDmCustomInfoType");
                return enumType != null ? Enum.ToObject(enumType, value) : value;
            }

            public object? CreateSearchOption(int searchFilters, string? searchPath)
            {
                var method = GetDmType("ISwDMApplication")?.GetMethod("GetSearchOptionObject");
                var searchOpt = method?.Invoke(_app, null);
                if (searchOpt == null) return null;

                dynamic dynOpt = searchOpt;
                dynOpt.SearchFilters = searchFilters;
                if (!string.IsNullOrEmpty(searchPath))
                {
                    try { dynOpt.AddSearchPath(searchPath); } catch { }
                }
                return searchOpt;
            }

            /// <summary>
            /// Invoke GetAllExternalReferences4, which the interop first declares on ISwDMDocument13.
            /// Reflection is required because the search option's runtime type does not match the
            /// declared parameter type, so dynamic binding fails.
            /// </summary>
            public string[]? GetAllExternalReferences(object doc, object searchOpt)
            {
                for (var version = 13; version <= 31; version++)
                {
                    var ifaceType = GetDmType($"ISwDMDocument{version}");
                    var method = ifaceType?.GetMethod("GetAllExternalReferences4");
                    if (ifaceType == null || method == null || !ifaceType.IsInstanceOfType(doc)) continue;

                    var parameters = new object?[] { searchOpt, null, null, null };
                    return method.Invoke(doc, parameters) as string[];
                }

                var legacy = doc.GetType().GetMethod("GetAllExternalReferences");
                return legacy?.Invoke(doc, new[] { searchOpt }) as string[];
            }

            public object[]? GetViews(object doc)
            {
                for (var version = 10; version <= 31; version++)
                {
                    var ifaceType = GetDmType($"ISwDMDocument{version}");
                    var method = ifaceType?.GetMethod("GetViews");
                    if (ifaceType == null || method == null || !ifaceType.IsInstanceOfType(doc)) continue;

                    return method.Invoke(doc, null) as object[];
                }
                return null;
            }

            public Type? ResolveType(string typeName) => GetDmType(typeName);

            private Type? GetDmType(string typeName) =>
                _assembly?.GetType($"SolidWorks.Interop.swdocumentmgr.{typeName}");

            private static IEnumerable<string> EnumerateSearchPaths()
            {
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var path in SolidWorksComRegistry.GetDocumentManagerDllCandidates())
                    if (seen.Add(path)) yield return path;

                foreach (var path in FallbackDllSearchPaths)
                    if (seen.Add(path)) yield return path;

                var custom = Environment.GetEnvironmentVariable("SOLIDWORKS_DM_DLL_PATH");
                if (!string.IsNullOrEmpty(custom) && seen.Add(custom!)) yield return custom!;
            }

            public void Dispose()
            {
                if (_app == null) return;
                try
                {
                    if (Marshal.IsComObject(_app)) Marshal.ReleaseComObject(_app);
                }
                catch
                {
                    // A failed release only leaks a handle for the lifetime of this short-lived process.
                }
                _app = null;
            }
        }

        #endregion
    }

    public sealed class ProbeOptions
    {
        public string FilePath { get; set; } = string.Empty;
        public string? Configuration { get; set; }
        public string? LicenseKey { get; set; }
        public bool AllowWrite { get; set; }
        public bool ProbeReadOnly { get; set; }
        public bool ProbeReferences { get; set; }
    }

    public sealed class ReferenceTrial
    {
        public int Filters { get; set; }
        public string Label { get; set; } = string.Empty;
        public bool IsProduction { get; set; }
        public int ReferenceCount { get; set; }
        public string Note { get; set; } = string.Empty;
        public List<string> References { get; } = new List<string>();
    }

    public sealed class DrawingViewInfo
    {
        public string Name { get; set; } = string.Empty;
        public string SheetName { get; set; } = string.Empty;
        public string ReferencedDocument { get; set; } = string.Empty;
        public string ReferencedConfiguration { get; set; } = string.Empty;
    }

    public sealed class InteropCandidate
    {
        public string Path { get; set; } = string.Empty;
        public bool Exists { get; set; }
        public string Version { get; set; } = string.Empty;
    }

    /// <summary>What a probe case is evidence of, so a verdict does not have to parse its label.</summary>
    public static class ProbeVariant
    {
        public const string ExistingKey = "existing-key";
        public const string NewKeyViaSet = "new-key-via-set";
        public const string ProductionInfoType = "production-info-type";
        public const string DocumentedInfoType = "documented-info-type";

        /// <summary>
        /// An empty value written the way production writes any value, which must leave the property
        /// present rather than remove it.
        /// </summary>
        public const string EmptyValue = "empty-value";

        /// <summary>
        /// An empty value written by a route production does not use: a control that isolates
        /// whether a failure is about the empty value or about the call, and the fallback that
        /// would be needed if the production routes stopped working.
        /// </summary>
        public const string EmptyValueControl = "empty-value-control";
    }

    public sealed class ProbeCase
    {
        public string Name { get; set; } = string.Empty;
        public string Scope { get; set; } = string.Empty;
        public string Variant { get; set; } = string.Empty;
        public string PropertyName { get; set; } = string.Empty;
        public string ExpectedValue { get; set; } = string.Empty;
        public string? ActualValue { get; set; }

        /// <summary>
        /// Whether the property name came back at all. An empty value makes this the whole question:
        /// "present and empty" and "not there" are the same <see cref="ActualValue"/> otherwise, and
        /// telling them apart is the point of the change this probe measures.
        /// </summary>
        public bool? PresentAfterWrite { get; set; }

        public string? ReturnValue { get; set; }
        public bool CallThrew { get; set; }
        public bool? Verified { get; set; }
        public string Notes { get; set; } = string.Empty;
    }

    public sealed class ProbeReport
    {
        public string FilePath { get; set; } = string.Empty;
        public bool WriteMode { get; set; }
        public string? Verdict { get; set; }

        /// <summary>Whether an empty custom property survives a write and a re-read.</summary>
        public string? EmptyValueVerdict { get; set; }

        public string? Error { get; set; }
        public string? Detail { get; set; }

        public string? DmAssemblyPath { get; set; }
        public string? DmAssemblyVersion { get; set; }
        public List<InteropCandidate> InteropCandidates { get; } = new List<InteropCandidate>();

        public long FileSizeBytes { get; set; }
        public DateTime FileLastWriteUtc { get; set; }
        public bool FileWasReadOnly { get; set; }
        public bool WroteWithReadOnlyAttribute { get; set; }

        public int ConfigurationCount { get; set; }
        public List<string> ConfigurationNames { get; } = new List<string>();
        public string? TargetConfiguration { get; set; }
        public Dictionary<string, string> FileLevelProperties { get; set; } = new Dictionary<string, string>();
        public Dictionary<string, string> ConfigLevelProperties { get; set; } = new Dictionary<string, string>();
        public Dictionary<string, string> FileLevelAfter { get; set; } = new Dictionary<string, string>();
        public Dictionary<string, string> ConfigLevelAfter { get; set; } = new Dictionary<string, string>();

        public int WriteOpenErrorCode { get; set; }
        public string? WriteOpenError { get; set; }
        public int SaveResultCode { get; set; }
        public string? SaveResult { get; set; }

        public string? BackupPath { get; set; }
        public string? HashBeforeWrite { get; set; }
        public string? HashAfterWrite { get; set; }
        public bool FileBytesChanged { get; set; }
        public bool? Restored { get; set; }
        public string? RestoreMessage { get; set; }
        public FixtureSweepReport? PreflightSweep { get; set; }

        public List<ProbeCase> Probes { get; } = new List<ProbeCase>();
        public List<ReferenceTrial> ReferenceTrials { get; } = new List<ReferenceTrial>();
        public List<DrawingViewInfo> DrawingViews { get; } = new List<DrawingViewInfo>();
    }
}
