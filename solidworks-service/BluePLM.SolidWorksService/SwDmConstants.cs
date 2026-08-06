using System;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Managed mirrors of the SolidWorks Document Manager enumerations, plus the specific values this
    /// service passes across the COM boundary.
    ///
    /// The Document Manager interop is loaded dynamically at runtime, so its enum types are not
    /// available at compile time and every value historically appeared as a bare integer at the call
    /// site. Two of those integers were wrong for years - neither was a member of the enum it was
    /// passed as, both were rejected by the API, and both rejections were discarded by the caller.
    ///
    /// Declaring them here gives them a name and, more importantly, gives
    /// BluePLM.SolidWorksService.Tests something to assert against the installed interop.
    /// </summary>
    public static class SwDmConstants
    {
        /// <summary>Interop enum name for <see cref="SwDmSearchFilter"/>.</summary>
        public const string SearchFiltersEnumName = "SwDmSearchFilters";

        /// <summary>Interop enum name for <see cref="SwDmCustomInfoType"/>.</summary>
        public const string CustomInfoTypeEnumName = "SwDmCustomInfoType";

        /// <summary>Interop enum name for <see cref="SwDmDocumentOpenError"/>.</summary>
        public const string DocumentOpenErrorEnumName = "SwDmDocumentOpenError";

        /// <summary>Interop enum name for <see cref="SwDmDocumentSaveError"/>.</summary>
        public const string DocumentSaveErrorEnumName = "SwDmDocumentSaveError";

        /// <summary>
        /// Filters used when resolving a document's external references.
        /// </summary>
        public const SwDmSearchFilter ReferenceResolutionFilters =
            SwDmSearchFilter.ExternalReference |
            SwDmSearchFilter.InContextReference |
            SwDmSearchFilter.RootAssemblyFolder |
            SwDmSearchFilter.Subfolders;

        /// <summary>
        /// Filters used when searching for a replacement component.
        /// </summary>
        public const SwDmSearchFilter ComponentSearchFilters = ReferenceResolutionFilters;

        /// <summary>
        /// Type passed to AddCustomProperty when writing a text custom property.
        /// </summary>
        public const SwDmCustomInfoType CustomPropertyTextType = SwDmCustomInfoType.Text;
    }

    /// <summary>
    /// Mirrors SolidWorks.Interop.swdocumentmgr.SwDmSearchFilters.
    /// These are search BEHAVIOUR and document TYPE flags combined in one bitmask; resolving external
    /// references requires <see cref="ExternalReference"/>, which the type flags do not imply.
    /// </summary>
    [Flags]
    public enum SwDmSearchFilter
    {
        None = 0,
        Subfolders = 1,
        ForPart = 2,
        ForDrawing = 4,
        ForAssembly = 8,
        ExternalReference = 16,
        InContextReference = 32,
        RootAssemblyFolder = 64,
        PartToBaseAssemblyReference = 128,
    }

    /// <summary>Mirrors SolidWorks.Interop.swdocumentmgr.SwDmCustomInfoType.</summary>
    public enum SwDmCustomInfoType
    {
        Unknown = 0,
        Number = 3,
        YesOrNo = 11,
        Text = 30,
        Date = 64,
        Equation = 105,
    }

    /// <summary>Mirrors SolidWorks.Interop.swdocumentmgr.SwDmDocumentOpenError.</summary>
    public enum SwDmDocumentOpenError
    {
        None = 0,
        Fail = 1,
        NonSW = 2,
        FileNotFound = 3,
        FileReadOnly = 4,
        NoLicense = 5,
        FutureVersion = 6,
    }

    /// <summary>Mirrors SolidWorks.Interop.swdocumentmgr.SwDmDocumentSaveError.</summary>
    public enum SwDmDocumentSaveError
    {
        None = 0,
        ReadOnly = 1,
        Fail = 2,
    }
}
