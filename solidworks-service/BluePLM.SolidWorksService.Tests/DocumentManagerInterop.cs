using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Locates and loads the SolidWorks Document Manager interop the service would load at runtime,
    /// so tests assert against the same assembly production uses rather than a checked-in copy.
    /// </summary>
    public static class DocumentManagerInterop
    {
        private const string InteropFileName = "SolidWorks.Interop.swdocumentmgr.dll";

        private static readonly Lazy<Assembly?> _assembly = new Lazy<Assembly?>(Load);

        public static Assembly? Assembly => _assembly.Value;

        public static bool IsAvailable => _assembly.Value != null;

        public static string? LoadedFrom { get; private set; }

        /// <summary>
        /// Resolve an enum type from the interop, failing the test with a useful message rather than
        /// a NullReferenceException when the interop shape changes.
        /// </summary>
        public static Type GetEnumType(string typeName)
        {
            var type = Assembly?.GetType($"SolidWorks.Interop.swdocumentmgr.{typeName}");
            Assert.True(type != null, $"{typeName} is not present in {LoadedFrom}");
            Assert.True(type!.IsEnum, $"{typeName} is not an enum in {LoadedFrom}");
            return type;
        }

        /// <summary>Every member of an interop enum, as name to integer value.</summary>
        public static IReadOnlyDictionary<string, int> GetMembers(string typeName)
        {
            var type = GetEnumType(typeName);
            return Enum.GetNames(type).ToDictionary(
                name => name,
                name => Convert.ToInt32(Enum.Parse(type, name)));
        }

        private static Assembly? Load()
        {
            foreach (var candidate in EnumerateCandidates())
            {
                if (!File.Exists(candidate)) continue;
                try
                {
                    var assembly = System.Reflection.Assembly.LoadFrom(candidate);
                    LoadedFrom = candidate;
                    return assembly;
                }
                catch (BadImageFormatException)
                {
                    // Wrong bitness for this test host; keep looking.
                }
            }
            return null;
        }

        private static IEnumerable<string> EnumerateCandidates()
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Same discovery order the service uses, so a version mismatch shows up here first.
            foreach (var path in SolidWorksComRegistry.GetDocumentManagerDllCandidates())
                if (seen.Add(path)) yield return path;

            var roots = new[]
            {
                @"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS",
                @"C:\Program Files\SolidWorks Corp\SolidWorks",
                @"C:\Program Files (x86)\SOLIDWORKS Corp\SOLIDWORKS",
            };

            foreach (var root in roots)
            {
                var path = Path.Combine(root, "api", "redist", InteropFileName);
                if (seen.Add(path)) yield return path;
            }

            var shared = Path.Combine(@"C:\Program Files\Common Files\SolidWorks Shared", InteropFileName);
            if (seen.Add(shared)) yield return shared;

            var custom = Environment.GetEnvironmentVariable("SOLIDWORKS_DM_DLL_PATH");
            if (!string.IsNullOrEmpty(custom) && seen.Add(custom!)) yield return custom!;
        }
    }

    /// <summary>
    /// A fact that skips, rather than fails, when SolidWorks is not installed on the machine running
    /// the tests. Keeps CI green without hiding a real failure on a developer machine.
    /// </summary>
    public sealed class RequiresDocumentManagerFactAttribute : FactAttribute
    {
        public RequiresDocumentManagerFactAttribute()
        {
            if (!DocumentManagerInterop.IsAvailable)
            {
                Skip = "SolidWorks Document Manager interop not installed on this machine";
            }
        }
    }
}
