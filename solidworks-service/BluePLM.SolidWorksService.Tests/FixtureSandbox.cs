using System;
using System.Collections.Generic;
using System.IO;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// A throwaway copy of one regression fixture folder, under %TEMP%.
    ///
    /// Nothing that can write is ever handed a vault path: the vault is read once, to copy, and the
    /// code under test only ever sees the copy. The copy is deleted when the sandbox is disposed,
    /// so a test that corrupts a fixture corrupts a temporary folder and nothing else.
    /// </summary>
    public sealed class FixtureSandbox : IDisposable
    {
        /// <summary>A 68-configuration part plus its drawings. Small enough to copy per test.</summary>
        public const string OringFixture = "REGRESSION-TEST-ORING";

        /// <summary>One part and one drawing, both read-only, as an unchecked-out vault file is.</summary>
        public const string ScrewFixture = "REGRESSION-TEST-SCREW";

        /// <summary>A real nested assembly tree of roughly 250 MB, so copying it is opt-in.</summary>
        public const string NestedAssemblyFixture = "REGRESSION-TEST-T500X";

        /// <summary>Set to 1 to allow the tests to copy <see cref="NestedAssemblyFixture"/>.</summary>
        public const string LargeFixtureOptInVariable = "BLUEPLM_REGRESSION_LARGE_FIXTURES";

        /// <summary>
        /// Deep enough for any fixture and shallow enough that a cycle cannot run the copy away.
        /// </summary>
        private const int MaxTraversalDepth = 12;

        private FixtureSandbox(string name, string sourcePath, string temporaryRoot, string root)
        {
            Name = name;
            SourcePath = sourcePath;
            TemporaryRoot = temporaryRoot;
            Root = root;
        }

        /// <summary>Fixture folder name, as it appears in the vault.</summary>
        public string Name { get; }

        /// <summary>Where the fixture was copied from. Never handed to the code under test.</summary>
        public string SourcePath { get; }

        /// <summary>The per-run temporary folder deleted on <see cref="Dispose"/>.</summary>
        public string TemporaryRoot { get; }

        /// <summary>The copied fixture folder. This is the path tests may write to.</summary>
        public string Root { get; }

        /// <summary>The vault folder a fixture is read from.</summary>
        public static string SourceFor(string fixtureName) =>
            Path.Combine(RegressionFixtureGuard.DefaultFixtureRoot, fixtureName);

        /// <summary>Whether the fixture exists on this machine.</summary>
        public static bool IsAvailable(string fixtureName) => Directory.Exists(SourceFor(fixtureName));

        /// <summary>Whether copying this fixture costs enough to require an explicit opt-in.</summary>
        public static bool RequiresOptIn(string fixtureName) =>
            string.Equals(fixtureName, NestedAssemblyFixture, StringComparison.OrdinalIgnoreCase);

        /// <summary>Whether that opt-in has been given.</summary>
        public static bool LargeFixturesEnabled =>
            string.Equals(Environment.GetEnvironmentVariable(LargeFixtureOptInVariable), "1", StringComparison.Ordinal);

        /// <summary>
        /// Copy one named fixture out of the vault into a fresh temporary folder.
        /// </summary>
        public static FixtureSandbox Create(string fixtureName)
        {
            if (RequiresOptIn(fixtureName) && !LargeFixturesEnabled)
            {
                throw new InvalidOperationException(
                    $"{fixtureName} is only copied when {LargeFixtureOptInVariable}=1.");
            }

            var source = SourceFor(fixtureName);
            if (!Directory.Exists(source))
                throw new DirectoryNotFoundException($"Fixture '{fixtureName}' not found at {source}");

            // The source is read, not written, but a fixture reached through a junction is not the
            // fixture and would make the whole comparison meaningless.
            if (!RegressionFixtureGuard.IsInside(source, RegressionFixtureGuard.DefaultFixtureRoot))
            {
                throw new InvalidOperationException(
                    RegressionFixtureGuard.DescribeRefusal(source, RegressionFixtureGuard.DefaultFixtureRoot));
            }

            var temporaryRoot = Path.Combine(Path.GetTempPath(), $"blueplm-regression-{Guid.NewGuid():N}");
            var root = Path.Combine(temporaryRoot, fixtureName);
            Directory.CreateDirectory(root);

            CopyTree(new DirectoryInfo(source), root, depth: 0);

            return new FixtureSandbox(fixtureName, source, temporaryRoot, root);
        }

        /// <summary>A file inside the sandbox, by its path relative to the fixture folder.</summary>
        public string PathTo(params string[] relativeSegments) =>
            Path.Combine(Root, Path.Combine(relativeSegments));

        public void Dispose()
        {
            if (!Directory.Exists(TemporaryRoot)) return;

            // SCREW is copied read-only on purpose, and Directory.Delete will not remove a
            // read-only file.
            ClearReadOnly(new DirectoryInfo(TemporaryRoot), depth: 0);

            try
            {
                Directory.Delete(TemporaryRoot, recursive: true);
            }
            catch (IOException)
            {
                // A handle the test failed to close outlives this process by seconds; %TEMP% is
                // swept anyway, and failing here would mask the test's own failure.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        private static void CopyTree(DirectoryInfo source, string destination, int depth)
        {
            if (depth > MaxTraversalDepth)
                throw new InvalidOperationException($"Fixture tree deeper than {MaxTraversalDepth} levels at {source.FullName}");

            if (source.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidOperationException($"Refusing to follow the reparse point at {source.FullName}");

            Directory.CreateDirectory(destination);

            // File.Copy carries the read-only attribute across, which is what makes the SCREW
            // fixture worth having.
            foreach (var file in source.GetFiles())
                file.CopyTo(Path.Combine(destination, file.Name), overwrite: true);

            foreach (var directory in source.GetDirectories())
                CopyTree(directory, Path.Combine(destination, directory.Name), depth + 1);
        }

        private static void ClearReadOnly(DirectoryInfo directory, int depth)
        {
            if (depth > MaxTraversalDepth) return;

            foreach (var file in directory.GetFiles())
            {
                if (file.IsReadOnly) file.IsReadOnly = false;
            }

            foreach (var child in directory.GetDirectories())
                ClearReadOnly(child, depth + 1);
        }
    }

    /// <summary>
    /// A fact that skips when the fixture it needs is absent, or when it is one of the fixtures
    /// that must be opted into.
    /// </summary>
    public sealed class RequiresFixtureFactAttribute : FactAttribute
    {
        public RequiresFixtureFactAttribute(string fixtureName)
        {
            if (!FixtureSandbox.IsAvailable(fixtureName))
            {
                Skip = $"Fixture '{fixtureName}' is not present under {RegressionFixtureGuard.DefaultFixtureRoot}";
            }
            else if (FixtureSandbox.RequiresOptIn(fixtureName) && !FixtureSandbox.LargeFixturesEnabled)
            {
                Skip = $"Fixture '{fixtureName}' is large; set {FixtureSandbox.LargeFixtureOptInVariable}=1 to include it";
            }
        }
    }

    /// <summary>Fixture names the suite knows about, for data-driven tests.</summary>
    public static class KnownFixtures
    {
        public static IEnumerable<string> Small => new[]
        {
            FixtureSandbox.OringFixture,
            FixtureSandbox.ScrewFixture,
        };
    }
}
