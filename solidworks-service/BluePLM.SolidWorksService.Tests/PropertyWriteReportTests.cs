using System.Linq;

using SolidWorks.Interop.swconst;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The SolidWorks COM write path reported success unconditionally: Set2, Add3, Delete2 and
    /// Save3 all say whether the write landed, and all four answers were discarded. These tests
    /// cover the decision logic that now reads them, none of which needs a live SolidWorks.
    /// </summary>
    public class PropertyWriteReportTests
    {
        private const string Scope = "-265";

        #region Result codes

        [Fact]
        public void Only_OK_counts_as_a_successful_Set2()
        {
            Assert.True(SwCustomPropertyResult.SetSucceeded((int)swCustomInfoSetResult_e.swCustomInfoSetResult_OK));

            Assert.False(SwCustomPropertyResult.SetSucceeded((int)swCustomInfoSetResult_e.swCustomInfoSetResult_NotPresent));
            Assert.False(SwCustomPropertyResult.SetSucceeded((int)swCustomInfoSetResult_e.swCustomInfoSetResult_TypeMismatch));
            Assert.False(SwCustomPropertyResult.SetSucceeded((int)swCustomInfoSetResult_e.swCustomInfoSetResult_LinkedProp));
        }

        [Fact]
        public void Only_AddedOrChanged_counts_as_a_successful_Add3()
        {
            Assert.True(SwCustomPropertyResult.AddSucceeded((int)swCustomInfoAddResult_e.swCustomInfoAddResult_AddedOrChanged));

            Assert.False(SwCustomPropertyResult.AddSucceeded((int)swCustomInfoAddResult_e.swCustomInfoAddResult_GenericFail));
            Assert.False(SwCustomPropertyResult.AddSucceeded((int)swCustomInfoAddResult_e.swCustomInfoAddResult_MismatchAgainstExistingType));
            Assert.False(SwCustomPropertyResult.AddSucceeded((int)swCustomInfoAddResult_e.swCustomInfoAddResult_MismatchAgainstSpecifiedType));
            Assert.False(SwCustomPropertyResult.AddSucceeded((int)swCustomInfoAddResult_e.swCustomInfoAddResult_MismatchAgainstLegacyTypes));
        }

        [Fact]
        public void Deleting_a_property_that_is_not_there_is_the_end_state_that_was_asked_for()
        {
            Assert.True(SwCustomPropertyResult.DeleteSucceeded((int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_OK));
            Assert.True(SwCustomPropertyResult.DeleteSucceeded((int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_NotPresent));

            Assert.False(SwCustomPropertyResult.DeleteSucceeded((int)swCustomInfoDeleteResult_e.swCustomInfoDeleteResult_LinkedProp));
        }

        [Fact]
        public void Every_result_code_describes_itself_rather_than_reporting_a_bare_number()
        {
            foreach (swCustomInfoSetResult_e value in System.Enum.GetValues(typeof(swCustomInfoSetResult_e)))
                Assert.DoesNotContain("unrecognised", SwCustomPropertyResult.DescribeSetResult((int)value));

            foreach (swCustomInfoAddResult_e value in System.Enum.GetValues(typeof(swCustomInfoAddResult_e)))
                Assert.DoesNotContain("unrecognised", SwCustomPropertyResult.DescribeAddResult((int)value));

            foreach (swCustomInfoDeleteResult_e value in System.Enum.GetValues(typeof(swCustomInfoDeleteResult_e)))
                Assert.DoesNotContain("unrecognised", SwCustomPropertyResult.DescribeDeleteResult((int)value));
        }

        #endregion

        #region Save3 errors

        [Fact]
        public void A_save_with_no_errors_is_a_success()
        {
            Assert.False(SwSaveError.IsFailure(0));
            Assert.Equal("saved", SwSaveError.Describe(0));
        }

        [Fact]
        public void A_read_only_file_is_the_routine_case_and_must_report_as_a_failure()
        {
            // BluePLM marks every unchecked-out vault file read-only, so this is the save result a
            // user hits most often. It was previously reported as a completed write.
            var errors = (int)swFileSaveError_e.swReadOnlySaveError;

            Assert.True(SwSaveError.IsFailure(errors));
            Assert.Contains("read-only", SwSaveError.Describe(errors));
        }

        [Fact]
        public void A_rebuild_error_still_wrote_the_file_so_it_is_not_a_write_failure()
        {
            var errors = (int)swFileSaveError_e.swFileSaveWithRebuildError;

            Assert.False(SwSaveError.IsFailure(errors));
            Assert.Contains("rebuild error", SwSaveError.Describe(errors));
        }

        [Fact]
        public void A_rebuild_error_alongside_a_real_failure_is_still_a_failure()
        {
            var errors = (int)swFileSaveError_e.swFileSaveWithRebuildError | (int)swFileSaveError_e.swFileLockError;

            Assert.True(SwSaveError.IsFailure(errors));
        }

        [Fact]
        public void Every_save_error_flag_is_reported_by_name()
        {
            foreach (swFileSaveError_e flag in System.Enum.GetValues(typeof(swFileSaveError_e)))
            {
                var description = SwSaveError.Describe((int)flag);

                Assert.DoesNotContain("unrecognised", description);
                Assert.NotEqual("saved", description);
            }
        }

        [Fact]
        public void A_combined_mask_names_every_reason_it_contains()
        {
            var errors = (int)swFileSaveError_e.swReadOnlySaveError | (int)swFileSaveError_e.swFileLockError;

            var description = SwSaveError.Describe(errors);

            Assert.Contains("read-only", description);
            Assert.Contains("locked", description);
        }

        [Fact]
        public void An_undefined_bit_is_reported_rather_than_swallowed()
        {
            const int undefinedBit = 1 << 20;

            Assert.True(SwSaveError.IsFailure(undefinedBit));
            Assert.Contains("unrecognised save error bits", SwSaveError.Describe(undefinedBit));
        }

        #endregion

        #region The report

        [Fact]
        public void A_report_with_no_failures_is_not_a_failure()
        {
            var report = new PropertyWriteReport();
            report.Record(Scope, "Number", PropertyWriteStatus.Updated);
            report.Record(Scope, "Tab Number", PropertyWriteStatus.Created);
            report.Record(Scope, "Description", PropertyWriteStatus.Deleted);

            Assert.Equal(3, report.Attempted);
            Assert.Equal(3, report.Written);
            Assert.Equal(0, report.Failed);
            Assert.False(report.AnyFailed);
            Assert.False(report.AllFailed);
            Assert.Empty(report.FailedProperties);
        }

        [Fact]
        public void A_partial_failure_is_counted_but_does_not_discard_what_landed()
        {
            var report = new PropertyWriteReport();
            report.Record(Scope, "Number", PropertyWriteStatus.Updated);
            report.Record(Scope, "Revision", PropertyWriteStatus.Failed, "SolidWorks refused the property");

            Assert.Equal(1, report.Written);
            Assert.Equal(1, report.Failed);
            Assert.True(report.AnyFailed);
            Assert.False(report.AllFailed);
            Assert.Equal(new[] { "-265:Revision" }, report.FailedProperties.ToArray());
        }

        [Fact]
        public void Nothing_landing_is_reported_as_a_total_failure()
        {
            var report = new PropertyWriteReport();
            report.Record(Scope, "Number", PropertyWriteStatus.Failed, "SolidWorks refused the property");
            report.Record(Scope, "Revision", PropertyWriteStatus.Failed, "SolidWorks refused the property");

            Assert.True(report.AllFailed);
            Assert.Equal(0, report.Written);
        }

        [Fact]
        public void An_empty_report_is_not_a_failure()
        {
            // No properties requested is not the same as every property refused.
            var report = new PropertyWriteReport();

            Assert.False(report.AllFailed);
            Assert.False(report.AnyFailed);
        }

        [Fact]
        public void Failures_are_described_with_the_scope_they_failed_on()
        {
            var report = new PropertyWriteReport();
            report.Record("file-level", "Number", PropertyWriteStatus.Failed, "property is linked");

            var description = report.DescribeFailures();

            Assert.Contains("file-level:Number", description);
            Assert.Contains("property is linked", description);
        }

        [Fact]
        public void Absorbing_another_scope_keeps_both_sets_of_outcomes()
        {
            var fileLevel = new PropertyWriteReport();
            fileLevel.Record("file-level", "Number", PropertyWriteStatus.Updated);

            var configLevel = new PropertyWriteReport();
            configLevel.Record(Scope, "Tab Number", PropertyWriteStatus.Failed, "refused");

            fileLevel.Absorb(configLevel);

            Assert.Equal(2, fileLevel.Attempted);
            Assert.Equal(1, fileLevel.Written);
            Assert.Equal(1, fileLevel.Failed);
            Assert.Equal(new[] { "-265:Tab Number" }, fileLevel.FailedProperties.ToArray());
        }

        #endregion
    }
}
