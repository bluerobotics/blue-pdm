using System;
using System.Diagnostics;
using System.IO;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The guard is the last thing standing between a diagnostic and a production vault file, so it
    /// is tested against the paths that defeat the naive version rather than only the happy one.
    /// </summary>
    public class RegressionFixtureGuardTests
    {
        private static readonly string Root = RegressionFixtureGuard.DefaultFixtureRoot;

        [Fact]
        public void A_file_inside_the_root_is_allowed()
        {
            var candidate = Path.Combine(Root, FixtureSandbox.OringFixture, "ORING-BUNA-70A.SLDPRT");

            Assert.True(RegressionFixtureGuard.IsInside(candidate, Root));
        }

        [Fact]
        public void The_root_itself_is_allowed()
        {
            Assert.True(RegressionFixtureGuard.IsInside(Root, Root));
        }

        [Fact]
        public void A_path_that_climbs_out_of_the_root_is_refused()
        {
            var escape = Path.Combine(Root, "..", "..", "real-parts", "PRODUCTION.SLDPRT");

            Assert.False(RegressionFixtureGuard.IsInside(escape, Root));
        }

        [Fact]
        public void The_folder_name_appearing_in_an_escaping_path_is_not_enough_to_allow_it()
        {
            var escape = Path.Combine(Root, "..", "..", "real-parts", "PRODUCTION.SLDPRT");

            Assert.True(
                escape.IndexOf("00 - REGRESSION TESTS", StringComparison.OrdinalIgnoreCase) >= 0,
                "This path is exactly the one a substring check accepts; the test is pointless if it does not contain the folder name.");
            Assert.False(RegressionFixtureGuard.IsInside(escape, Root));
        }

        [Fact]
        public void A_sibling_folder_whose_name_starts_with_the_root_is_refused()
        {
            var sibling = Path.Combine(Root + "-EVIL", "PRODUCTION.SLDPRT");

            Assert.False(RegressionFixtureGuard.IsInside(sibling, Root));
        }

        [Fact]
        public void A_path_somewhere_else_entirely_is_refused()
        {
            Assert.False(RegressionFixtureGuard.IsInside(@"C:\Windows\Temp\PRODUCTION.SLDPRT", Root));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("|not|a|path|")]
        public void An_unusable_path_is_refused(string? candidate)
        {
            Assert.False(RegressionFixtureGuard.IsInside(candidate, Root));
        }

        [Fact]
        public void A_junction_planted_inside_the_root_is_refused()
        {
            using var layout = new JunctionLayout();
            if (!layout.Created) return;

            Assert.True(
                RegressionFixtureGuard.IsInside(layout.RealFileInsideRoot, layout.Root),
                "A genuine file inside the root must still be allowed, or the reparse check is simply refusing everything.");

            Assert.False(RegressionFixtureGuard.IsInside(layout.FileReachedThroughJunction, layout.Root));
        }

        [Fact]
        public void The_allowed_root_can_be_pointed_at_a_sandbox()
        {
            var original = Environment.GetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable);
            var sandbox = Path.Combine(Path.GetTempPath(), $"blueplm-guard-{Guid.NewGuid():N}");

            try
            {
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, sandbox);

                Assert.True(RegressionFixtureGuard.IsInsideAllowedRoot(Path.Combine(sandbox, "copy.SLDPRT")));
                Assert.False(RegressionFixtureGuard.IsInsideAllowedRoot(Path.Combine(Root, "REAL.SLDPRT")));
            }
            finally
            {
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, original);
            }
        }

        /// <summary>
        /// A real junction under a real root. Path.GetFullPath cannot see it, so nothing short of
        /// creating one proves the ancestor walk does.
        /// </summary>
        private sealed class JunctionLayout : IDisposable
        {
            private readonly string _base;

            public JunctionLayout()
            {
                _base = Path.Combine(Path.GetTempPath(), $"blueplm-junction-{Guid.NewGuid():N}");
                Root = Path.Combine(_base, "root");
                var outside = Path.Combine(_base, "outside");

                Directory.CreateDirectory(Root);
                Directory.CreateDirectory(outside);

                RealFileInsideRoot = Path.Combine(Root, "genuine.SLDPRT");
                File.WriteAllText(RealFileInsideRoot, "genuine");
                File.WriteAllText(Path.Combine(outside, "PRODUCTION.SLDPRT"), "production");

                var junction = Path.Combine(Root, "hop");
                FileReachedThroughJunction = Path.Combine(junction, "PRODUCTION.SLDPRT");
                Created = TryCreateJunction(junction, outside);
            }

            public bool Created { get; }
            public string Root { get; }
            public string RealFileInsideRoot { get; }
            public string FileReachedThroughJunction { get; }

            private static bool TryCreateJunction(string link, string target)
            {
                try
                {
                    var process = Process.Start(new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = $"/c mklink /J \"{link}\" \"{target}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                    });

                    process?.WaitForExit();
                    return process?.ExitCode == 0 && Directory.Exists(link);
                }
                catch (Exception)
                {
                    return false;
                }
            }

            public void Dispose()
            {
                try
                {
                    // Deleting the junction itself, not what it points at.
                    var junction = Path.Combine(Root, "hop");
                    if (Directory.Exists(junction)) Directory.Delete(junction);
                    if (Directory.Exists(_base)) Directory.Delete(_base, recursive: true);
                }
                catch (IOException)
                {
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
        }
    }
}
