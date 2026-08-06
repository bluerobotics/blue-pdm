using System;
using System.IO;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Decides whether a path may be written to by a diagnostic or a regression test.
    ///
    /// Anything that writes to a real SolidWorks document is one typo away from modifying a
    /// production vault file, so the answer is computed rather than assumed. A substring match on
    /// the folder name is not enough: it accepts <c>...\00 - REGRESSION TESTS\..\..\real-parts</c>,
    /// it accepts a sibling folder whose name merely starts with the root, and it cannot see a
    /// junction planted inside the fixture folder that redirects the write somewhere else.
    /// </summary>
    public static class RegressionFixtureGuard
    {
        /// <summary>Only folder in the vault a write is ever permitted to reach.</summary>
        public const string DefaultFixtureRoot = @"C:\BluePLM\br-vault\0 - SHARED\00 - REGRESSION TESTS";

        /// <summary>
        /// Overrides <see cref="DefaultFixtureRoot"/>, so a test can point a spawned diagnostic at a
        /// throwaway copy of a fixture instead of the vault.
        /// </summary>
        public const string FixtureRootVariable = "BLUEPLM_FIXTURE_ROOT";

        /// <summary>
        /// A fixture path is a handful of levels below its root. Refusing to walk further keeps a
        /// crafted or cyclic path from turning the ancestor check into an unbounded loop.
        /// </summary>
        private const int MaxAncestorDepth = 12;

        /// <summary>The root writes are currently confined to.</summary>
        public static string ResolveAllowedRoot()
        {
            var configured = Environment.GetEnvironmentVariable(FixtureRootVariable);
            return string.IsNullOrWhiteSpace(configured) ? DefaultFixtureRoot : configured!;
        }

        /// <summary>Whether <paramref name="candidate"/> is inside <see cref="ResolveAllowedRoot"/>.</summary>
        public static bool IsInsideAllowedRoot(string? candidate) => IsInside(candidate, ResolveAllowedRoot());

        /// <summary>
        /// Whether <paramref name="candidate"/> resolves to <paramref name="root"/> or something
        /// beneath it, reached without traversing a reparse point.
        /// </summary>
        public static bool IsInside(string? candidate, string? root)
        {
            if (string.IsNullOrWhiteSpace(candidate) || string.IsNullOrWhiteSpace(root)) return false;

            if (!TryNormalise(candidate!, out var fullCandidate)) return false;
            if (!TryNormalise(root!, out var fullRoot)) return false;

            if (string.Equals(fullCandidate, fullRoot, StringComparison.OrdinalIgnoreCase)) return true;

            // The separator is what stops "00 - REGRESSION TESTS-EVIL" from passing as the root.
            if (!fullCandidate.StartsWith(fullRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return false;

            return !CrossesReparsePoint(fullCandidate, fullRoot);
        }

        /// <summary>
        /// Explains a refusal, for a diagnostic that has to tell its operator why it did nothing.
        /// </summary>
        public static string DescribeRefusal(string? candidate, string? root) =>
            $"'{candidate}' does not resolve to a location inside '{root}' " +
            "(the path escapes the root, or reaches it through a junction or symbolic link).";

        private static bool TryNormalise(string path, out string normalised)
        {
            try
            {
                normalised = Path.GetFullPath(path)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                return normalised.Length > 0;
            }
            catch (Exception)
            {
                // Malformed, too long, or an unsupported path shape - none of which can be trusted.
                normalised = string.Empty;
                return false;
            }
        }

        /// <summary>
        /// Path.GetFullPath collapses "..", but resolves nothing about the file system: a junction
        /// under the root still points wherever it likes. Every level between the candidate and the
        /// root has to be inspected directly.
        /// </summary>
        private static bool CrossesReparsePoint(string fullCandidate, string fullRoot)
        {
            var current = fullCandidate;

            for (var depth = 0; depth < MaxAncestorDepth; depth++)
            {
                if (string.Equals(current, fullRoot, StringComparison.OrdinalIgnoreCase)) return false;

                if (IsReparsePoint(current)) return true;

                var parent = Path.GetDirectoryName(current);
                if (string.IsNullOrEmpty(parent) || string.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                    return true;

                current = parent!;
            }

            return true;
        }

        private static bool IsReparsePoint(string path)
        {
            try
            {
                if (!File.Exists(path) && !Directory.Exists(path)) return false;
                return File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint);
            }
            catch (Exception)
            {
                // Unreadable attributes cannot be cleared as safe.
                return true;
            }
        }
    }
}
