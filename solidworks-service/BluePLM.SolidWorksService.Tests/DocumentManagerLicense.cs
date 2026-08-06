using System;
using System.IO;

using Newtonsoft.Json.Linq;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Finds the Document Manager licence key a reference read needs, the same way the app does.
    ///
    /// Without a key Document Manager will not open a document at all, so the fixture tests would
    /// silently degrade into asserting nothing. They skip instead, and say why.
    ///
    /// The key is never written to a log or an assertion message. Only where it was found is.
    /// </summary>
    public static class DocumentManagerLicense
    {
        /// <summary>Checked first, so CI can supply a key without the app being installed.</summary>
        public const string EnvironmentVariable = "BLUEPLM_DM_LICENSE_KEY";

        /// <summary>Where the Electron main process persists the key for its own early boot.</summary>
        private const string AutoStartConfigFileName = "sw-autostart.json";

        private const string AutoStartConfigFolder = "blue-plm";

        private static readonly Lazy<DiscoveredLicense> _discovered = new Lazy<DiscoveredLicense>(Discover);

        /// <summary>The licence key, or null when this machine has none configured.</summary>
        public static string? Key => _discovered.Value.Key;

        /// <summary>Where the key came from, for a skip message. Never the key itself.</summary>
        public static string Source => _discovered.Value.Source;

        public static bool IsAvailable => !string.IsNullOrWhiteSpace(Key);

        private static DiscoveredLicense Discover()
        {
            var fromEnvironment = Environment.GetEnvironmentVariable(EnvironmentVariable);
            if (!string.IsNullOrWhiteSpace(fromEnvironment))
                return new DiscoveredLicense(fromEnvironment, $"the {EnvironmentVariable} environment variable");

            var configPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                AutoStartConfigFolder,
                AutoStartConfigFileName);

            if (!File.Exists(configPath))
                return new DiscoveredLicense(null, $"nowhere ({EnvironmentVariable} unset, {configPath} absent)");

            try
            {
                var key = JObject.Parse(File.ReadAllText(configPath))["dmLicenseKey"]?.ToString();
                return string.IsNullOrWhiteSpace(key)
                    ? new DiscoveredLicense(null, $"{configPath}, which carries no dmLicenseKey")
                    : new DiscoveredLicense(key, configPath);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is Newtonsoft.Json.JsonException)
            {
                return new DiscoveredLicense(null, $"{configPath}, which could not be read: {ex.Message}");
            }
        }

        private sealed class DiscoveredLicense
        {
            public DiscoveredLicense(string? key, string source)
            {
                Key = key;
                Source = source;
            }

            public string? Key { get; }

            public string Source { get; }
        }
    }
}
