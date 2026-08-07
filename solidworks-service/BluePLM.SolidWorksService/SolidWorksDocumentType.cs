using System;
using System.IO;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// What a SolidWorks document's extension alone settles about it.
    ///
    /// One place rather than at each call site, because the fact below is the difference
    /// between "this document has no configurations" and "the enumeration failed", and two
    /// callers deciding it independently is how those two answers became one.
    /// </summary>
    public static class SolidWorksDocumentType
    {
        /// <summary>Drawings, the only document type with no configurations.</summary>
        public const string DrawingExtension = ".slddrw";

        /// <summary>
        /// Whether the document carries no configurations at all, so a refusal from its
        /// ConfigurationManager is the answer rather than a failure.
        ///
        /// Only drawings, and this is measured rather than assumed: a drawing's
        /// ConfigurationManager throws E_FAIL out of GetConfigurationNames instead of
        /// returning an empty array. A part or an assembly always has at least Default, so a
        /// refusal there is a failed read and has to be reported as one.
        ///
        /// An unknown or missing path answers false, which routes it to the strict side. A
        /// document whose type cannot be established is one whose empty configuration list
        /// cannot be trusted.
        /// </summary>
        public static bool HasNoConfigurations(string? filePath) =>
            !string.IsNullOrWhiteSpace(filePath) &&
            string.Equals(Path.GetExtension(filePath), DrawingExtension, StringComparison.OrdinalIgnoreCase);
    }
}
