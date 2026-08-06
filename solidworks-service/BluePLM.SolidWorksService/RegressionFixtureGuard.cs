using System;
using System.Collections.Generic;
using System.IO;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Decides whether a path may be written to by a diagnostic or a regression test.
    ///
    /// Anything that writes to a real SolidWorks document is one typo away from modifying a
    /// production vault file, so this is an authorisation decision rather than a string comparison,
    /// and it is answered the same way round every time: a path is refused unless it can be proven
    /// to be inside the root. Anything that cannot be proven either way is refused.
    ///
    /// What "proven" means here:
    ///
    /// - The path is absolute and names a volume, so the verdict cannot change with the process
    ///   working directory. Relative paths are refused, not resolved. Resolving an operator's
    ///   argument is the caller's job; see the <c>--dm-probe</c> handling in Program.cs.
    /// - The path is already canonical. No <c>..</c>, no <c>.</c>, no 8.3 short name, no name ending
    ///   in a dot or a space. The guard does not collapse or expand anything, so it cannot be fooled
    ///   by a shape whose collapsing rules it got wrong.
    /// - The path does not use the <c>\\?\</c> or <c>\\.\</c> prefix. Those switch off Win32 path
    ///   normalisation entirely - Windows leaves <c>..</c> in such a path unresolved - which voids
    ///   every assumption below.
    /// - Containment is decided component by component, not by string prefix, so a sibling named
    ///   <c>00 - REGRESSION TESTS ARCHIVE</c> cannot pass as the root.
    /// - No junction or symbolic link stands anywhere between the volume root and the path, the
    ///   allowed root itself included. A reparse point makes the name a lie, and one planted at or
    ///   above the root redirects the whole fixture folder.
    ///
    /// What it does not prove: that the answer is still true a moment later. Nothing that inspects a
    /// path and then acts on it can promise that, so the callers back a write with
    /// <see cref="FixtureBackup"/> rather than relying on this alone.
    /// </summary>
    public static class RegressionFixtureGuard
    {
        /// <summary>Only folder in the vault a write is ever permitted to reach.</summary>
        public const string DefaultFixtureRoot = @"C:\BluePLM\br-vault\0 - SHARED\00 - REGRESSION TESTS";

        /// <summary>
        /// Overrides <see cref="DefaultFixtureRoot"/>, so a test can point a spawned diagnostic at a
        /// throwaway copy of a fixture instead of the vault. It must itself be an absolute, canonical
        /// path; a root that does not satisfy the rules above refuses everything.
        /// </summary>
        public const string FixtureRootVariable = "BLUEPLM_FIXTURE_ROOT";

        /// <summary>A fixture path is a handful of levels below its root, never more than this.</summary>
        private const int MaxDepthBelowRoot = 12;

        /// <summary>
        /// Total components a path may have, root included. Splitting on separators cannot loop, so
        /// this is only here to stop a crafted path turning the ancestor walk into thousands of
        /// file system calls.
        /// </summary>
        private const int MaxPathComponents = 64;

        private static readonly char[] Separators = { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar };

        private static readonly string SeparatorText = Path.DirectorySeparatorChar.ToString();

        /// <summary>Characters that cannot appear in a component of a path this guard will allow.</summary>
        private static readonly char[] ForbiddenInComponent = { ':', '*', '?', '"', '<', '>', '|' };

        /// <summary>What the volume root and the components below it turned out to be.</summary>
        private enum Probe
        {
            /// <summary>Attributes were read.</summary>
            Readable,

            /// <summary>Nothing is there, so nothing below it can be there either.</summary>
            Absent,

            /// <summary>Something is there but the guard cannot see what. Never treated as safe.</summary>
            Unreadable,
        }

        /// <summary>The root writes are currently confined to.</summary>
        public static string ResolveAllowedRoot()
        {
            var configured = Environment.GetEnvironmentVariable(FixtureRootVariable);
            return string.IsNullOrWhiteSpace(configured) ? DefaultFixtureRoot : configured!;
        }

        /// <summary>Whether <paramref name="candidate"/> is inside <see cref="ResolveAllowedRoot"/>.</summary>
        public static bool IsInsideAllowedRoot(string? candidate) => IsInside(candidate, ResolveAllowedRoot());

        /// <summary>
        /// Whether <paramref name="candidate"/> is <paramref name="root"/> or something proven to be
        /// beneath it. See the type's remarks for what has to hold for the answer to be true.
        /// </summary>
        public static bool IsInside(string? candidate, string? root) => FindRefusal(candidate, root) == null;

        /// <summary>
        /// Explains a refusal, for a diagnostic that has to tell its operator why it did nothing.
        /// </summary>
        public static string DescribeRefusal(string? candidate, string? root)
        {
            var refusal = FindRefusal(candidate, root);

            return refusal == null
                ? $"'{candidate}' does resolve to a location inside '{root}'."
                : $"'{candidate}' is not allowed inside '{root}': {refusal}";
        }

        /// <summary>The reason to refuse, or null when there is none.</summary>
        private static string? FindRefusal(string? candidate, string? root)
        {
            if (!TryReadPath(root, out var rootVolume, out var rootComponents, out var rootRefusal))
                return $"the allowed root cannot be used as a boundary - {rootRefusal}";

            if (!TryReadPath(candidate, out var volume, out var components, out var refusal))
                return refusal;

            if (!Same(volume, rootVolume))
                return $"it is on '{volume}' and the root is on '{rootVolume}'";

            if (components.Count < rootComponents.Count)
                return "it is above the root rather than inside it";

            for (var index = 0; index < rootComponents.Count; index++)
            {
                if (!Same(components[index], rootComponents[index]))
                    return $"its '{components[index]}' component is not the root's '{rootComponents[index]}'";
            }

            var depth = components.Count - rootComponents.Count;
            if (depth > MaxDepthBelowRoot)
                return $"it is {depth} levels below the root, and a fixture is never more than {MaxDepthBelowRoot}";

            return FindReparsePoint(volume, components);
        }

        /// <summary>
        /// Split an absolute path into its volume and the named components below it, refusing any
        /// shape whose meaning is not settled by the text alone.
        ///
        /// Three rewrites are permitted, because each is lossless and cannot change which file is
        /// named: forward slashes count as separators, runs of separators count as one, and a
        /// trailing separator is dropped. Everything else has to be literal.
        /// </summary>
        private static bool TryReadPath(string? path, out string volume, out List<string> components, out string refusal)
        {
            volume = string.Empty;
            components = new List<string>();

            if (string.IsNullOrWhiteSpace(path))
            {
                refusal = "it is empty";
                return false;
            }

            var text = path!.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);

            if (text.StartsWith(@"\\?\", StringComparison.Ordinal) || text.StartsWith(@"\\.\", StringComparison.Ordinal))
            {
                refusal = "it uses the extended-length or device prefix, which switches off the path " +
                          "normalisation the rest of this guard depends on - Windows leaves '..' in such " +
                          "a path unresolved";
                return false;
            }

            int belowVolume;
            if (text.StartsWith(@"\\", StringComparison.Ordinal))
            {
                // \\server\share is the volume. Anything shorter names nothing to be inside of.
                var afterServer = text.IndexOf(Path.DirectorySeparatorChar, 2);
                if (afterServer < 0 || afterServer == 2)
                {
                    refusal = "it names no server and share";
                    return false;
                }

                var afterShare = text.IndexOf(Path.DirectorySeparatorChar, afterServer + 1);
                var volumeEnd = afterShare < 0 ? text.Length : afterShare;
                if (volumeEnd <= afterServer + 1)
                {
                    refusal = "it names a server but no share";
                    return false;
                }

                volume = text.Substring(0, volumeEnd);
                belowVolume = volumeEnd;
            }
            else if (text.Length >= 3 && IsDriveLetter(text[0]) && text[1] == ':' && text[2] == Path.DirectorySeparatorChar)
            {
                volume = text.Substring(0, 3);
                belowVolume = 3;
            }
            else
            {
                refusal = "it is not an absolute path on a named volume, so its meaning would depend on " +
                          "the process working directory rather than on the path itself";
                return false;
            }

            foreach (var component in text.Substring(belowVolume).Split(Separators, StringSplitOptions.RemoveEmptyEntries))
            {
                var componentRefusal = InspectComponent(component);
                if (componentRefusal != null)
                {
                    refusal = componentRefusal;
                    return false;
                }

                components.Add(component);

                if (components.Count > MaxPathComponents)
                {
                    refusal = $"it has more than {MaxPathComponents} components";
                    return false;
                }
            }

            refusal = string.Empty;
            return true;
        }

        /// <summary>Why one component makes the path unusable, or null when it does not.</summary>
        private static string? InspectComponent(string component)
        {
            if (component == "." || component == "..")
            {
                return $"it contains a '{component}' segment, and the guard deliberately does not " +
                       "resolve those - a path has to arrive already canonical";
            }

            foreach (var character in component)
            {
                if (character < ' ')
                    return $"its '{component}' component contains a control character";
            }

            var forbidden = component.IndexOfAny(ForbiddenInComponent);
            if (forbidden >= 0)
                return $"its '{component}' component contains '{component[forbidden]}', which no file name may";

            var last = component[component.Length - 1];
            if (last == '.' || last == ' ')
            {
                return $"its '{component}' component ends in {(last == ' ' ? "a space" : "a dot")}, which " +
                       "Windows strips, so the name is an alias for a different one";
            }

            if (LooksLikeShortName(component))
            {
                return $"its '{component}' component is an 8.3 short name, which is an alias for a longer " +
                       "name and cannot be compared against the root as written";
            }

            return null;
        }

        /// <summary>
        /// PROGRA~1, 00-REG~1: at most eight characters ending in a tilde and digits, and at most a
        /// three character extension.
        ///
        /// The leading tilde is required to be part of a longer stem, which is what keeps the
        /// SolidWorks leftovers the sweeper has to recognise - ~$PART.SLDPRT, PART.~sldprt - out of
        /// this. Their extensions are six characters long and their tildes lead.
        /// </summary>
        private static bool LooksLikeShortName(string component)
        {
            var dot = component.LastIndexOf('.');
            var stem = dot < 0 ? component : component.Substring(0, dot);
            var extension = dot < 0 ? string.Empty : component.Substring(dot + 1);

            if (stem.Length == 0 || stem.Length > 8 || extension.Length > 3) return false;
            if (stem.IndexOf('.') >= 0) return false;

            var tilde = stem.LastIndexOf('~');
            if (tilde <= 0 || tilde == stem.Length - 1) return false;

            for (var index = tilde + 1; index < stem.Length; index++)
            {
                if (!char.IsDigit(stem[index])) return false;
            }

            return true;
        }

        /// <summary>
        /// Walk the volume root, then every component down to the candidate, looking for a reparse
        /// point. The allowed root and everything above it are included on purpose: a junction there
        /// redirects the entire fixture folder, which is the one case this guard exists to catch, and
        /// an earlier version stopped the walk the moment it reached the root and so never looked.
        /// </summary>
        private static string? FindReparsePoint(string volume, List<string> components)
        {
            var path = volume;

            for (var index = 0; ; index++)
            {
                switch (ReadAttributes(path, out var attributes, out var error))
                {
                    case Probe.Unreadable:
                        return $"the guard cannot read the attributes of '{path}' ({error}), so it cannot " +
                               "rule out a junction there";

                    case Probe.Absent:
                        // Nothing below an absent directory exists either, so nothing left can redirect.
                        return null;
                }

                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    return $"'{path}' is a junction or a symbolic link, so the path does not stay where " +
                           "its name says it does";
                }

                if (index >= components.Count) return null;

                path = path.EndsWith(SeparatorText, StringComparison.Ordinal)
                    ? path + components[index]
                    : path + SeparatorText + components[index];
            }
        }

        /// <summary>
        /// Attributes, absence, and "cannot tell" kept apart on purpose.
        ///
        /// An earlier version asked File.Exists and Directory.Exists first and returned "not a
        /// reparse point" when both said no. Both of them answer no for a directory the process is
        /// not allowed to look at, which quietly turned an unreadable ancestor into a safe one and
        /// left the catch below unreachable for the case it was written for.
        /// </summary>
        private static Probe ReadAttributes(string path, out FileAttributes attributes, out string error)
        {
            attributes = default(FileAttributes);
            error = string.Empty;

            try
            {
                attributes = File.GetAttributes(path);
                return Probe.Readable;
            }
            catch (FileNotFoundException)
            {
                return Probe.Absent;
            }
            catch (DirectoryNotFoundException)
            {
                return Probe.Absent;
            }
            catch (Exception failure)
            {
                error = failure.GetType().Name;
                return Probe.Unreadable;
            }
        }

        private static bool IsDriveLetter(char character) =>
            (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');

        private static bool Same(string left, string right) =>
            string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    }
}
