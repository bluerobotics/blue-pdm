using System;
using System.Collections.Generic;
using System.Linq;

using SolidWorks.Interop.swconst;

namespace BluePLM.SolidWorksService
{
    /// <summary>What happened to one property on one scope.</summary>
    public enum PropertyWriteStatus
    {
        /// <summary>The property already existed and its value was replaced.</summary>
        Updated,

        /// <summary>The property did not exist and was created.</summary>
        Created,

        /// <summary>An empty value was requested, so the property was removed.</summary>
        Deleted,

        /// <summary>The API refused the write, or threw.</summary>
        Failed,
    }

    /// <summary>The outcome of writing one property, named so a failure can be reported back.</summary>
    public sealed class PropertyWriteOutcome
    {
        public PropertyWriteOutcome(string scope, string name, PropertyWriteStatus status, string? detail = null)
        {
            Scope = scope;
            Name = name;
            Status = status;
            Detail = detail;
        }

        /// <summary>Configuration name, or "file-level".</summary>
        public string Scope { get; }

        public string Name { get; }

        public PropertyWriteStatus Status { get; }

        /// <summary>Why it failed, when it failed.</summary>
        public string? Detail { get; }

        public bool Succeeded => Status != PropertyWriteStatus.Failed;

        public string QualifiedName => $"{Scope}:{Name}";
    }

    /// <summary>
    /// Accumulates the per-property outcomes of a write so the caller can report what actually
    /// happened instead of assuming every requested property landed.
    ///
    /// The SolidWorks COM property calls all return a result code and the service discarded every
    /// one of them, so a refused write was indistinguishable from a successful one all the way up
    /// to the toast. This is the record that makes the difference visible.
    /// </summary>
    public sealed class PropertyWriteReport
    {
        private readonly List<PropertyWriteOutcome> _outcomes = new List<PropertyWriteOutcome>();

        public IReadOnlyList<PropertyWriteOutcome> Outcomes => _outcomes;

        public void Record(string scope, string name, PropertyWriteStatus status, string? detail = null) =>
            _outcomes.Add(new PropertyWriteOutcome(scope, name, status, detail));

        /// <summary>Fold another scope's outcomes into this report.</summary>
        public void Absorb(PropertyWriteReport other)
        {
            if (other == null) throw new ArgumentNullException(nameof(other));
            _outcomes.AddRange(other._outcomes);
        }

        public int Attempted => _outcomes.Count;

        public int Written => _outcomes.Count(o => o.Succeeded);

        public int Failed => _outcomes.Count(o => !o.Succeeded);

        public IReadOnlyList<string> FailedProperties =>
            _outcomes.Where(o => !o.Succeeded).Select(o => o.QualifiedName).ToList();

        public bool AnyFailed => Failed > 0;

        /// <summary>
        /// Nothing landed. The caller must not report success, and must not save: there is nothing
        /// to save and a save would only hide the failure behind a green result code.
        /// </summary>
        public bool AllFailed => Written == 0 && Failed > 0;

        public string DescribeFailures() =>
            string.Join(", ", _outcomes.Where(o => !o.Succeeded)
                .Select(o => o.Detail == null ? o.QualifiedName : $"{o.QualifiedName} ({o.Detail})"));
    }

    /// <summary>
    /// Interprets the result codes returned by ICustomPropertyManager. Every one of these methods
    /// returns a code that production discarded.
    /// </summary>
    public static class SwCustomPropertyResult
    {
        public static bool SetSucceeded(int result) =>
            result == (int)swCustomInfoSetResult_e.swCustomInfoSetResult_OK;

        public static bool AddSucceeded(int result) =>
            result == (int)swCustomInfoAddResult_e.swCustomInfoAddResult_AddedOrChanged;

        /// <summary>
        /// A property that is not there is the end state a delete was asking for, so NotPresent is
        /// success. A linked property cannot be removed and is a real failure.
        /// </summary>
        public static bool DeleteSucceeded(int result) =>
            result == (int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_OK ||
            result == (int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_NotPresent;

        public static string DescribeSetResult(int result)
        {
            switch (result)
            {
                case (int)swCustomInfoSetResult_e.swCustomInfoSetResult_OK:
                    return "set";
                case (int)swCustomInfoSetResult_e.swCustomInfoSetResult_NotPresent:
                    return "property does not exist yet";
                case (int)swCustomInfoSetResult_e.swCustomInfoSetResult_TypeMismatch:
                    return "existing property has a different type";
                case (int)swCustomInfoSetResult_e.swCustomInfoSetResult_LinkedProp:
                    return "property is linked and cannot be set directly";
                default:
                    return $"unrecognised set result {result}";
            }
        }

        public static string DescribeAddResult(int result)
        {
            switch (result)
            {
                case (int)swCustomInfoAddResult_e.swCustomInfoAddResult_AddedOrChanged:
                    return "added";
                case (int)swCustomInfoAddResult_e.swCustomInfoAddResult_GenericFail:
                    return "SolidWorks refused the property";
                case (int)swCustomInfoAddResult_e.swCustomInfoAddResult_MismatchAgainstExistingType:
                    return "type does not match the existing property";
                case (int)swCustomInfoAddResult_e.swCustomInfoAddResult_MismatchAgainstSpecifiedType:
                    return "value does not match the requested type";
                case (int)swCustomInfoAddResult_e.swCustomInfoAddResult_MismatchAgainstLegacyTypes:
                    return "type does not match the legacy property type";
                default:
                    return $"unrecognised add result {result}";
            }
        }

        public static string DescribeDeleteResult(int result)
        {
            switch (result)
            {
                case (int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_OK:
                    return "deleted";
                case (int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_NotPresent:
                    return "was not present";
                case (int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_LinkedProp:
                    return "property is linked and cannot be deleted";
                default:
                    return $"unrecognised delete result {result}";
            }
        }
    }

    /// <summary>
    /// Decodes the errors bitmask that ModelDoc2.Save3 writes to its out-parameter.
    ///
    /// The service passed this parameter by reference and never looked at it, so a save SolidWorks
    /// refused - a read-only vault file being the routine case - was reported to the user as a
    /// completed write.
    /// </summary>
    public static class SwSaveError
    {
        /// <summary>
        /// The document was written to disk, but SolidWorks flagged a rebuild error while doing it.
        /// The properties did land, so this is not a write failure.
        /// </summary>
        private const int SavedWithWarningFlags = (int)swFileSaveError_e.swFileSaveWithRebuildError;

        public static bool IsFailure(int errors) => (errors & ~SavedWithWarningFlags) != 0;

        public static string Describe(int errors)
        {
            if (errors == 0) return "saved";

            var reasons = new List<string>();
            foreach (swFileSaveError_e flag in Enum.GetValues(typeof(swFileSaveError_e)))
            {
                if ((errors & (int)flag) == 0) continue;
                reasons.Add(DescribeFlag(flag));
            }

            var unrecognised = errors;
            foreach (swFileSaveError_e flag in Enum.GetValues(typeof(swFileSaveError_e)))
            {
                unrecognised &= ~(int)flag;
            }
            if (unrecognised != 0) reasons.Add($"unrecognised save error bits {unrecognised}");

            return string.Join("; ", reasons);
        }

        private static string DescribeFlag(swFileSaveError_e flag)
        {
            switch (flag)
            {
                case swFileSaveError_e.swGenericSaveError:
                    return "SolidWorks could not save the file";
                case swFileSaveError_e.swReadOnlySaveError:
                    return "the file is read-only - check it out first";
                case swFileSaveError_e.swFileNameEmpty:
                    return "the file has no name";
                case swFileSaveError_e.swFileNameContainsAtSign:
                    return "the file name contains an @ sign";
                case swFileSaveError_e.swFileLockError:
                    return "the file is locked by another process";
                case swFileSaveError_e.swFileSaveFormatNotAvailable:
                    return "that save format is not available";
                case swFileSaveError_e.swFileSaveWithRebuildError:
                    return "saved, but the model has a rebuild error";
                case swFileSaveError_e.swFileSaveAsDoNotOverwrite:
                    return "a file of that name already exists";
                case swFileSaveError_e.swFileSaveAsInvalidFileExtension:
                    return "the file extension is not valid";
                case swFileSaveError_e.swFileSaveAsNoSelection:
                    return "nothing was selected to save";
                case swFileSaveError_e.swFileSaveAsBadEDrawingsVersion:
                    return "the eDrawings version is not supported";
                case swFileSaveError_e.swFileSaveAsNameExceedsMaxPathLength:
                    return "the full path is too long for Windows";
                case swFileSaveError_e.swFileSaveAsNotSupported:
                    return "saving this document is not supported";
                case swFileSaveError_e.swFileSaveRequiresSavingReferences:
                    return "the file's references have to be saved as well";
                case swFileSaveError_e.swFileSaveAsDetachedDrawingsNotSupported:
                    return "detached drawings cannot be saved this way";
                default:
                    return $"save error {(int)flag}";
            }
        }
    }
}
