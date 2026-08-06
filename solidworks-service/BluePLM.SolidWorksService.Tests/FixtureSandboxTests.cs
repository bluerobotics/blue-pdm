using System;
using System.IO;
using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Proves the containment the rest of the suite relies on: fixtures are exercised as temporary
    /// copies, the vault is only ever read, and the copies do not survive the test that made them.
    /// </summary>
    public class FixtureSandboxTests
    {
        [RequiresFixtureFact(FixtureSandbox.OringFixture)]
        public void A_sandbox_is_a_complete_copy_outside_the_vault()
        {
            string temporaryRoot;

            using (var sandbox = FixtureSandbox.Create(FixtureSandbox.OringFixture))
            {
                temporaryRoot = sandbox.TemporaryRoot;

                Assert.True(Directory.Exists(sandbox.Root));
                Assert.False(
                    RegressionFixtureGuard.IsInside(sandbox.Root, RegressionFixtureGuard.DefaultFixtureRoot),
                    $"The sandbox at {sandbox.Root} is inside the vault; the copy is pointless.");

                var copied = Directory.GetFiles(sandbox.Root, "*", SearchOption.AllDirectories);
                var original = Directory.GetFiles(sandbox.SourcePath, "*", SearchOption.AllDirectories);
                Assert.Equal(original.Length, copied.Length);

                foreach (var file in original)
                {
                    var counterpart = Path.Combine(sandbox.Root, file.Substring(sandbox.SourcePath.Length + 1));
                    Assert.True(File.Exists(counterpart), $"{counterpart} was not copied");
                    Assert.Equal(FixtureTripwire.Hash(file), FixtureTripwire.Hash(counterpart));
                }
            }

            Assert.False(Directory.Exists(temporaryRoot), "The sandbox outlived its test.");
        }

        [RequiresFixtureFact(FixtureSandbox.ScrewFixture)]
        public void A_read_only_fixture_stays_read_only_in_the_sandbox_and_still_deletes()
        {
            string temporaryRoot;

            using (var sandbox = FixtureSandbox.Create(FixtureSandbox.ScrewFixture))
            {
                temporaryRoot = sandbox.TemporaryRoot;

                var copies = Directory.GetFiles(sandbox.Root, "*", SearchOption.AllDirectories)
                    .Select(path => new FileInfo(path))
                    .ToList();

                Assert.NotEmpty(copies);
                Assert.All(copies, file => Assert.True(
                    file.IsReadOnly,
                    $"{file.Name} lost its read-only attribute in the copy; the fixture no longer represents an unchecked-out vault file."));
            }

            Assert.False(Directory.Exists(temporaryRoot), "A read-only copy blocked the cleanup.");
        }

        [Fact]
        public void The_large_fixture_is_opt_in()
        {
            Assert.True(FixtureSandbox.RequiresOptIn(FixtureSandbox.NestedAssemblyFixture));
            Assert.False(FixtureSandbox.RequiresOptIn(FixtureSandbox.OringFixture));

            if (FixtureSandbox.LargeFixturesEnabled) return;

            Assert.Throws<InvalidOperationException>(
                () => FixtureSandbox.Create(FixtureSandbox.NestedAssemblyFixture));
        }

        [RequiresFixtureFact(FixtureSandbox.OringFixture)]
        public void Running_a_sandbox_leaves_the_vault_untouched()
        {
            var before = FixtureTripwire.Capture(FixtureTripwire.DefaultWatchList());
            Assert.NotEmpty(before.Entries);

            using (var sandbox = FixtureSandbox.Create(FixtureSandbox.OringFixture))
            {
                var target = Directory.GetFiles(sandbox.Root).First();
                new FileInfo(target).IsReadOnly = false;
                File.AppendAllText(target, "a test writing to its own copy");
            }

            var after = FixtureTripwire.Capture(FixtureTripwire.DefaultWatchList());

            Assert.Empty(after.DifferencesFrom(before));
        }

        [RequiresFixtureFact(FixtureSandbox.OringFixture)]
        public void The_tripwire_reports_a_change_it_is_watching()
        {
            using var sandbox = FixtureSandbox.Create(FixtureSandbox.OringFixture);

            var before = FixtureTripwire.Capture(new[] { sandbox.Root });

            var target = Directory.GetFiles(sandbox.Root).First();
            new FileInfo(target).IsReadOnly = false;
            File.AppendAllText(target, "modified");

            var differences = FixtureTripwire.Capture(new[] { sandbox.Root }).DifferencesFrom(before);

            Assert.Contains(differences, difference => difference.StartsWith("modified: ", StringComparison.Ordinal));
        }
    }
}
