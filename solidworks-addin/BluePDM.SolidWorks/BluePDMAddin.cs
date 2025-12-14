using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;
using SolidWorks.Interop.swpublished;

namespace BluePLM.SolidWorks
{
    /// <summary>
    /// BluePLM SolidWorks Add-in
    /// Provides PDM integration directly within SolidWorks
    /// </summary>
    [ComVisible(true)]
    [Guid("D4E5F6A7-8901-2345-6789-ABCDEF012345")]
    [ProgId("BluePLM.SolidWorks.Addin")]
    public class BluePLMAddin : ISwAddin
    {
        #region Fields

        private ISldWorks? _swApp;
        private ICommandManager? _cmdMgr;
        private int _addinCookie;

        // Command Group IDs
        private const int MainCmdGroupId = 1;
        
        // Command IDs
        private const int CmdCheckOut = 0;
        private const int CmdCheckIn = 1;
        private const int CmdUndoCheckOut = 2;
        private const int CmdGetLatest = 3;
        private const int CmdShowHistory = 4;
        private const int CmdShowTaskPane = 5;
        private const int CmdSettings = 6;

        // Task Pane
        private TaskpaneView? _taskPaneView;
        private TaskPaneHost? _taskPaneHost;
        
        // Services
        private SupabaseService? _supabaseService;
        private FileStatusCache? _fileStatusCache;

        #endregion

        #region COM Registration

        [ComRegisterFunction]
        public static void RegisterFunction(Type t)
        {
            try
            {
                var keyPath = $@"SOFTWARE\SolidWorks\Addins\{{{t.GUID}}}";
                using var key = Registry.LocalMachine.CreateSubKey(keyPath);
                key?.SetValue(null, 0); // Load at startup = false (change to 1 for auto-load)
                key?.SetValue("Title", "BluePLM");
                key?.SetValue("Description", "Product Lifecycle Management for SolidWorks - Check in/out, version control, and collaboration");
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to register add-in: {ex.Message}", "BluePLM Registration Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        [ComUnregisterFunction]
        public static void UnregisterFunction(Type t)
        {
            try
            {
                var keyPath = $@"SOFTWARE\SolidWorks\Addins\{{{t.GUID}}}";
                Registry.LocalMachine.DeleteSubKeyTree(keyPath, false);
            }
            catch
            {
                // Ignore errors during unregistration
            }
        }

        #endregion

        #region ISwAddin Implementation

        public bool ConnectToSW(object ThisSW, int Cookie)
        {
            // MINIMAL VERSION - just store references, do nothing else
            try
            {
                _swApp = (ISldWorks)ThisSW;
                _addinCookie = Cookie;
                
                // That's it - don't create any UI or services for now
                // Just prove the add-in can load
                
                return true;
            }
            catch
            {
                return false;
            }
        }

        private void LogError(string context, Exception ex)
        {
            try
            {
                var logPath = Path.Combine(
                    System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData),
                    "BluePLM",
                    "error.log"
                );
                Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
                File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {context}: {ex.Message}\n{ex.StackTrace}\n\n");
            }
            catch
            {
                // Ignore logging errors
            }
        }

        public bool DisconnectFromSW()
        {
            // MINIMAL VERSION - just cleanup references
            _swApp = null;
            _cmdMgr = null;
            return true;
        }

        #endregion

        #region Command Group

        private void CreateCommandGroup()
        {
            if (_cmdMgr == null) return;

            // Check if group already exists
            var cmdGroup = _cmdMgr.GetCommandGroup(MainCmdGroupId);
            if (cmdGroup != null)
            {
                _cmdMgr.RemoveCommandGroup(MainCmdGroupId);
            }

            // Define icons (use embedded resources in production)
            var icons = new string[]
            {
                "", // Small icons path
                "", // Large icons path
            };

            int errors = 0;
            cmdGroup = _cmdMgr.CreateCommandGroup2(
                MainCmdGroupId,
                "BluePLM",
                "BluePLM - Product Lifecycle Management",
                "BluePLM Commands",
                -1, // Position
                true,
                ref errors
            );

            if (cmdGroup == null) return;

            // Define commands
            var commands = new[]
            {
                new { Id = CmdCheckOut, Name = "Check Out", Hint = "Check out the active document for editing", Pos = 0 },
                new { Id = CmdCheckIn, Name = "Check In", Hint = "Check in the active document", Pos = 1 },
                new { Id = CmdUndoCheckOut, Name = "Undo Check Out", Hint = "Discard changes and release lock", Pos = 2 },
                new { Id = CmdGetLatest, Name = "Get Latest", Hint = "Download the latest version from server", Pos = 3 },
                new { Id = CmdShowHistory, Name = "History", Hint = "View version history", Pos = 4 },
                new { Id = CmdShowTaskPane, Name = "Task Pane", Hint = "Show/hide BluePLM task pane", Pos = 5 },
                new { Id = CmdSettings, Name = "Settings", Hint = "Configure BluePLM connection", Pos = 6 },
            };

            foreach (var cmd in commands)
            {
                cmdGroup.AddCommandItem2(
                    cmd.Name,
                    cmd.Pos,
                    cmd.Hint,
                    cmd.Hint,
                    cmd.Id,
                    $"Callback_{cmd.Id}",
                    $"Enable_{cmd.Id}",
                    cmd.Id,
                    (int)swCommandItemType_e.swMenuItem | (int)swCommandItemType_e.swToolbarItem
                );
            }

            cmdGroup.HasToolbar = true;
            cmdGroup.HasMenu = true;
            cmdGroup.Activate();

            // Add to toolbar
            var toolbar = _cmdMgr.AddCommandTab((int)swDocumentTypes_e.swDocPART, "BluePLM");
            if (toolbar == null)
            {
                toolbar = _cmdMgr.GetCommandTab((int)swDocumentTypes_e.swDocPART, "BluePLM");
            }
        }

        private void RemoveCommandGroup()
        {
            _cmdMgr?.RemoveCommandGroup(MainCmdGroupId);
        }

        #endregion

        #region Command Callbacks

        // These methods are called by SolidWorks via reflection based on the callback names

        public void Callback_0() => ExecuteCheckOut();
        public void Callback_1() => ExecuteCheckIn();
        public void Callback_2() => ExecuteUndoCheckOut();
        public void Callback_3() => ExecuteGetLatest();
        public void Callback_4() => ExecuteShowHistory();
        public void Callback_5() => ToggleTaskPane();
        public void Callback_6() => ShowSettings();

        public int Enable_0() => CanCheckOut() ? 1 : 0;
        public int Enable_1() => CanCheckIn() ? 1 : 0;
        public int Enable_2() => CanUndoCheckOut() ? 1 : 0;
        public int Enable_3() => HasActiveDocument() ? 1 : 0;
        public int Enable_4() => HasActiveDocument() ? 1 : 0;
        public int Enable_5() => 1; // Always enabled
        public int Enable_6() => 1; // Always enabled

        #endregion

        #region Command Implementations

        private bool HasActiveDocument()
        {
            var doc = _swApp?.ActiveDoc as ModelDoc2;
            return doc != null && !string.IsNullOrEmpty(doc.GetPathName());
        }

        private bool CanCheckOut()
        {
            if (!HasActiveDocument() || _fileStatusCache == null) return false;
            
            var doc = _swApp?.ActiveDoc as ModelDoc2;
            if (doc == null) return false;
            
            var status = _fileStatusCache.GetStatus(doc.GetPathName());
            return status?.CanCheckOut ?? false;
        }

        private bool CanCheckIn()
        {
            if (!HasActiveDocument() || _fileStatusCache == null) return false;
            
            var doc = _swApp?.ActiveDoc as ModelDoc2;
            if (doc == null) return false;
            
            var status = _fileStatusCache.GetStatus(doc.GetPathName());
            return status?.IsCheckedOutByMe ?? false;
        }

        private bool CanUndoCheckOut()
        {
            return CanCheckIn(); // Same condition
        }

        private async void ExecuteCheckOut()
        {
            if (_swApp == null || _supabaseService == null) return;

            var doc = _swApp.ActiveDoc as ModelDoc2;
            if (doc == null) return;

            var filePath = doc.GetPathName();
            if (string.IsNullOrEmpty(filePath)) return;

            try
            {
                SetStatusBarText($"BluePLM: Checking out {Path.GetFileName(filePath)}...");

                var result = await _supabaseService.CheckOutFile(filePath);
                
                if (result.Success)
                {
                    _fileStatusCache?.Invalidate(filePath);
                    _taskPaneHost?.RefreshStatus();
                    SetStatusBarText($"BluePLM: {Path.GetFileName(filePath)} checked out successfully");
                    
                    // Set document to read-write
                    doc.SetReadOnlyState(false);
                }
                else
                {
                    MessageBox.Show(result.Error, "Check Out Failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    SetStatusBarText($"BluePLM: Check out failed - {result.Error}");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error checking out file: {ex.Message}", "BluePLM Error", 
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private async void ExecuteCheckIn()
        {
            if (_swApp == null || _supabaseService == null) return;

            var doc = _swApp.ActiveDoc as ModelDoc2;
            if (doc == null) return;

            var filePath = doc.GetPathName();
            if (string.IsNullOrEmpty(filePath)) return;

            try
            {
                // Show check-in dialog
                using var dialog = new CheckInDialog(filePath, _fileStatusCache?.GetStatus(filePath));
                if (dialog.ShowDialog() != DialogResult.OK) return;

                // Save the document first
                SetStatusBarText($"BluePLM: Saving {Path.GetFileName(filePath)}...");
                
                int errors = 0, warnings = 0;
                doc.Save3(
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    ref errors,
                    ref warnings
                );

                if (errors != 0)
                {
                    MessageBox.Show("Failed to save document before check-in.", "Check In Failed",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                // Extract custom properties
                var customProps = ExtractCustomProperties(doc);

                SetStatusBarText($"BluePLM: Checking in {Path.GetFileName(filePath)}...");

                var result = await _supabaseService.CheckInFile(
                    filePath,
                    dialog.Comment,
                    dialog.IncrementRevision,
                    dialog.NewState,
                    customProps
                );

                if (result.Success)
                {
                    _fileStatusCache?.Invalidate(filePath);
                    _taskPaneHost?.RefreshStatus();
                    SetStatusBarText($"BluePLM: {Path.GetFileName(filePath)} checked in successfully (v{result.Version})");
                }
                else
                {
                    MessageBox.Show(result.Error, "Check In Failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    SetStatusBarText($"BluePLM: Check in failed - {result.Error}");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error checking in file: {ex.Message}", "BluePLM Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private async void ExecuteUndoCheckOut()
        {
            if (_swApp == null || _supabaseService == null) return;

            var doc = _swApp.ActiveDoc as ModelDoc2;
            if (doc == null) return;

            var filePath = doc.GetPathName();
            if (string.IsNullOrEmpty(filePath)) return;

            var confirm = MessageBox.Show(
                $"Are you sure you want to undo check out of {Path.GetFileName(filePath)}?\n\nAll local changes will be lost.",
                "Undo Check Out",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            );

            if (confirm != DialogResult.Yes) return;

            try
            {
                SetStatusBarText($"BluePLM: Undoing check out of {Path.GetFileName(filePath)}...");

                var result = await _supabaseService.UndoCheckOut(filePath);

                if (result.Success)
                {
                    _fileStatusCache?.Invalidate(filePath);
                    
                    // Close and reopen to get the original version
                    _swApp.CloseDoc(filePath);
                    
                    // Download the original version
                    await _supabaseService.GetLatestVersion(filePath);
                    
                    // Reopen
                    int errors = 0, warnings = 0;
                    _swApp.OpenDoc6(filePath, 
                        (int)GetDocType(filePath),
                        (int)swOpenDocOptions_e.swOpenDocOptions_ReadOnly,
                        "", ref errors, ref warnings);
                    
                    _taskPaneHost?.RefreshStatus();
                    SetStatusBarText($"BluePLM: Check out undone for {Path.GetFileName(filePath)}");
                }
                else
                {
                    MessageBox.Show(result.Error, "Undo Check Out Failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error undoing check out: {ex.Message}", "BluePLM Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private async void ExecuteGetLatest()
        {
            if (_swApp == null || _supabaseService == null) return;

            var doc = _swApp.ActiveDoc as ModelDoc2;
            if (doc == null) return;

            var filePath = doc.GetPathName();
            if (string.IsNullOrEmpty(filePath)) return;

            try
            {
                SetStatusBarText($"BluePLM: Getting latest version of {Path.GetFileName(filePath)}...");

                // Close document first
                _swApp.CloseDoc(filePath);

                var result = await _supabaseService.GetLatestVersion(filePath);

                if (result.Success)
                {
                    // Reopen
                    int errors = 0, warnings = 0;
                    _swApp.OpenDoc6(filePath,
                        (int)GetDocType(filePath),
                        (int)swOpenDocOptions_e.swOpenDocOptions_Silent,
                        "", ref errors, ref warnings);

                    _fileStatusCache?.Invalidate(filePath);
                    _taskPaneHost?.RefreshStatus();
                    SetStatusBarText($"BluePLM: Got latest version of {Path.GetFileName(filePath)} (v{result.Version})");
                }
                else
                {
                    MessageBox.Show(result.Error, "Get Latest Failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error getting latest version: {ex.Message}", "BluePLM Error",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void ExecuteShowHistory()
        {
            if (_swApp == null) return;

            var doc = _swApp.ActiveDoc as ModelDoc2;
            if (doc == null) return;

            var filePath = doc.GetPathName();
            if (string.IsNullOrEmpty(filePath)) return;

            using var dialog = new HistoryDialog(filePath, _supabaseService!);
            dialog.ShowDialog();
        }

        private void ToggleTaskPane()
        {
            if (_taskPaneView == null) return;

            // ShowView returns the visibility state
            _taskPaneView.ShowView();
        }

        private void ShowSettings()
        {
            using var dialog = new SettingsDialog(_supabaseService!);
            if (dialog.ShowDialog() == DialogResult.OK)
            {
                // Reconnect with new settings
                _supabaseService?.Connect(dialog.SupabaseUrl, dialog.SupabaseKey);
                _fileStatusCache?.Clear();
                _taskPaneHost?.RefreshStatus();
            }
        }

        #endregion

        #region Task Pane

        private void CreateTaskPane()
        {
            if (_swApp == null) return;

            try
            {
                // Create the task pane with embedded WPF control
                _taskPaneHost = new TaskPaneHost(_swApp, _supabaseService!, _fileStatusCache!);
                
                _taskPaneView = _swApp.CreateTaskpaneView2(
                    "", // Icon path (empty for now)
                    "BluePLM"
                );

                if (_taskPaneView != null)
                {
                    _taskPaneView.DisplayWindowFromHandle(_taskPaneHost.Handle.ToInt32());
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to create task pane: {ex.Message}");
            }
        }

        private void RemoveTaskPane()
        {
            if (_taskPaneView != null)
            {
                try
                {
                    _taskPaneView.DeleteView();
                }
                catch
                {
                    // Ignore errors during cleanup
                }
                _taskPaneView = null;
            }

            _taskPaneHost?.Dispose();
            _taskPaneHost = null;
        }

        #endregion

        #region Events

        private void SubscribeToEvents()
        {
            if (_swApp == null) return;

            // Subscribe to document events
            var swEvents = (SldWorks)_swApp;
            swEvents.ActiveDocChangeNotify += OnActiveDocChanged;
            swEvents.FileOpenNotify2 += OnFileOpened;
            swEvents.FileCloseNotify += OnFileClosed;
        }

        private void UnsubscribeFromEvents()
        {
            if (_swApp == null) return;

            try
            {
                var swEvents = (SldWorks)_swApp;
                swEvents.ActiveDocChangeNotify -= OnActiveDocChanged;
                swEvents.FileOpenNotify2 -= OnFileOpened;
                swEvents.FileCloseNotify -= OnFileClosed;
            }
            catch
            {
                // Ignore errors during unsubscription
            }
        }

        private int OnActiveDocChanged()
        {
            _taskPaneHost?.RefreshStatus();
            return 0;
        }

        private int OnFileOpened(string fileName)
        {
            // Check file status when opened
            _fileStatusCache?.PreloadStatus(fileName);
            
            // If file is not checked out, set to read-only
            var status = _fileStatusCache?.GetStatus(fileName);
            if (status != null && !status.IsCheckedOutByMe)
            {
                var doc = _swApp?.GetOpenDocument(fileName) as ModelDoc2;
                doc?.SetReadOnlyState(true);
            }

            _taskPaneHost?.RefreshStatus();
            return 0;
        }

        private int OnFileClosed(string fileName, int reason)
        {
            _taskPaneHost?.RefreshStatus();
            return 0;
        }

        #endregion

        #region Helpers

        private Dictionary<string, object?> ExtractCustomProperties(ModelDoc2 doc)
        {
            var props = new Dictionary<string, object?>();

            try
            {
                var ext = doc.Extension;
                var manager = ext.CustomPropertyManager[""];

                object names = null!;
                object types = null!;
                object values = null!;
                object resolved = null!;
                object linkToProperty = null!;
                manager.GetAll3(ref names, ref types, ref values, ref resolved, ref linkToProperty);

                if (names is string[] nameArray && values is string[] valueArray)
                {
                    for (int i = 0; i < nameArray.Length; i++)
                    {
                        props[nameArray[i]] = valueArray[i];
                    }
                }
            }
            catch
            {
                // Ignore errors reading properties
            }

            return props;
        }

        /// <summary>
        /// Helper method to set status bar text (handles different API versions)
        /// </summary>
        private void SetStatusBarText(string message)
        {
            try
            {
                // Frame is a method in ISldWorks that returns a Frame object
                var frame = (Frame)_swApp?.Frame();
                frame?.SetStatusBarText(message);
            }
            catch
            {
                // Ignore status bar errors
            }
        }

        private swDocumentTypes_e GetDocType(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            return ext switch
            {
                ".sldprt" => swDocumentTypes_e.swDocPART,
                ".sldasm" => swDocumentTypes_e.swDocASSEMBLY,
                ".slddrw" => swDocumentTypes_e.swDocDRAWING,
                _ => swDocumentTypes_e.swDocNONE
            };
        }

        #endregion
    }
}

