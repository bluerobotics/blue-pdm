using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// One Document Manager application and one sandboxed copy of each fixture it is asked for,
    /// shared across a test class.
    ///
    /// Both are expensive: acquiring the Document Manager application costs a licence handshake, and
    /// the fixtures are hundreds of megabytes. Neither depends on the order tests run in, because
    /// every read here is read-only.
    ///
    /// The code under test only ever sees the %TEMP% copy. The vault is read once, to make it.
    /// </summary>
    public sealed class DocumentManagerFixtures : IDisposable
    {
        private readonly Dictionary<string, FixtureSandbox> _sandboxes =
            new Dictionary<string, FixtureSandbox>(StringComparer.OrdinalIgnoreCase);

        private DocumentManagerAPI? _api;
        private bool _disposed;

        /// <summary>
        /// The Document Manager handle every test in the class shares.
        /// </summary>
        public DocumentManagerAPI Api
        {
            get
            {
                if (_api != null) return _api;

                var api = new DocumentManagerAPI(DocumentManagerLicense.Key);
                Assert.True(
                    api.Initialize(),
                    $"Document Manager would not initialise: {api.InitializationError} " +
                    $"(licence from {DocumentManagerLicense.Source})");

                _api = api;
                return _api;
            }
        }

        /// <summary>A throwaway copy of one fixture, made on first use and reused after that.</summary>
        public FixtureSandbox Sandbox(string fixtureName)
        {
            if (_sandboxes.TryGetValue(fixtureName, out var existing)) return existing;

            var created = FixtureSandbox.Create(fixtureName);
            _sandboxes[fixtureName] = created;
            return created;
        }

        /// <summary>A file inside a sandboxed fixture, asserted to exist so a rename fails loudly.</summary>
        public string PathTo(string fixtureName, string relativePath)
        {
            var path = Sandbox(fixtureName).PathTo(relativePath);
            Assert.True(File.Exists(path), $"{relativePath} is not in the {fixtureName} fixture");
            return path;
        }

        /// <summary>Every file in a sandboxed fixture with the given extension, in a stable order.</summary>
        public IReadOnlyList<string> FilesWithExtension(string fixtureName, string extension) =>
            Directory
                .GetFiles(Sandbox(fixtureName).Root, "*" + extension, SearchOption.TopDirectoryOnly)
                .OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase)
                .ToList();

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            // Document Manager holds the document handles; release them before deleting the copies,
            // or the sandbox cleanup silently leaves a folder behind in %TEMP%.
            _api?.Dispose();
            _api = null;

            foreach (var sandbox in _sandboxes.Values)
                sandbox.Dispose();

            _sandboxes.Clear();
        }
    }

    /// <summary>
    /// Everything a reference read against a real fixture needs, and which of them this machine
    /// is missing.
    /// </summary>
    internal static class DocumentManagerFixtureRequirements
    {
        /// <summary>Null when the test can run, otherwise the reason it cannot.</summary>
        internal static string? MissingRequirement(string fixtureName)
        {
            if (!DocumentManagerInterop.IsAvailable)
                return "SolidWorks Document Manager interop not installed on this machine";

            if (!DocumentManagerLicense.IsAvailable)
                return $"No Document Manager licence key; set {DocumentManagerLicense.EnvironmentVariable} " +
                       $"or configure one in the app (looked in {DocumentManagerLicense.Source})";

            if (!FixtureSandbox.IsAvailable(fixtureName))
                return $"Fixture '{fixtureName}' is not present under {RegressionFixtureGuard.DefaultFixtureRoot}";

            if (FixtureSandbox.RequiresOptIn(fixtureName) && !FixtureSandbox.LargeFixturesEnabled)
                return $"Fixture '{fixtureName}' is large; set {FixtureSandbox.LargeFixtureOptInVariable}=1 to include it";

            return null;
        }
    }

    /// <summary>
    /// A fact that reads a real fixture through Document Manager, skipping when the interop, the
    /// licence or the fixture is absent rather than failing on a machine that cannot run it.
    /// </summary>
    public sealed class DocumentManagerFixtureFactAttribute : FactAttribute
    {
        public DocumentManagerFixtureFactAttribute(string fixtureName)
        {
            Skip = DocumentManagerFixtureRequirements.MissingRequirement(fixtureName);
        }
    }

    /// <summary>The theory form of <see cref="DocumentManagerFixtureFactAttribute"/>.</summary>
    public sealed class DocumentManagerFixtureTheoryAttribute : TheoryAttribute
    {
        public DocumentManagerFixtureTheoryAttribute(string fixtureName)
        {
            Skip = DocumentManagerFixtureRequirements.MissingRequirement(fixtureName);
        }
    }
}
