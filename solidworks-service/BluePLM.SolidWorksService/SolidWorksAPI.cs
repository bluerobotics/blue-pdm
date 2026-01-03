using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Unified SolidWorks API handler.
    /// Uses the full SolidWorks API for all operations.
    /// SolidWorks runs in background (hidden) when needed.
    /// </summary>
    public class SolidWorksAPI : IDisposable
    {
        private ISldWorks? _swApp;
        private bool _weStartedSW;
        private bool _keepRunning;
        private bool _disposed;

        public SolidWorksAPI(bool keepRunning = true)
        {
            _keepRunning = keepRunning;
        }

        #region Connection Management

        /// <summary>
        /// Check if SolidWorks is available on this machine
        /// </summary>
        public bool IsSolidWorksAvailable()
        {
            try
            {
                var swType = Type.GetTypeFromProgID("SldWorks.Application");
                return swType != null;
            }
            catch
            {
                return false;
            }
        }

        private ISldWorks GetSolidWorks()
        {
            if (_swApp != null)
            {
                // Check if still running
                try
                {
                    var version = _swApp.RevisionNumber();
                    return _swApp;
                }
                catch
                {
                    _swApp = null;
                }
            }

            // Try to connect to running instance
            try
            {
                _swApp = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
                _weStartedSW = false;
                return _swApp;
            }
            catch
            {
                // No running instance, start one
            }

            // Start SolidWorks
            var swType = Type.GetTypeFromProgID("SldWorks.Application");
            if (swType == null)
                throw new Exception("SolidWorks is not installed on this machine");

            _swApp = (ISldWorks)Activator.CreateInstance(swType)!;
            _weStartedSW = true;

            // Run hidden
            _swApp.Visible = false;
            _swApp.UserControl = false;

            // Wait for SolidWorks to be ready
            int attempts = 0;
            while (!_swApp.StartupProcessCompleted && attempts < 120)
            {
                Thread.Sleep(500);
                attempts++;
            }

            if (!_swApp.StartupProcessCompleted)
                throw new Exception("SolidWorks failed to start within 60 seconds");

            return _swApp;
        }

        private void CloseSolidWorksIfWeStartedIt()
        {
            if (!_keepRunning && _weStartedSW && _swApp != null)
            {
                try
                {
                    _swApp.ExitApp();
                    _swApp = null;
                    _weStartedSW = false;
                }
                catch { }
            }
        }

        private ModelDoc2? OpenDocument(string filePath, out int errors, out int warnings, bool readOnly = true)
        {
            errors = 0;
            warnings = 0;

            var sw = GetSolidWorks();
            var docType = GetDocumentType(filePath);

            if (docType == swDocumentTypes_e.swDocNONE)
                return null;

            var options = readOnly
                ? swOpenDocOptions_e.swOpenDocOptions_ReadOnly | swOpenDocOptions_e.swOpenDocOptions_Silent
                : swOpenDocOptions_e.swOpenDocOptions_Silent;

            return (ModelDoc2)sw.OpenDoc6(
                filePath,
                (int)docType,
                (int)options,
                "",
                ref errors,
                ref warnings
            );
        }

        private void CloseDocument(string filePath)
        {
            try
            {
                _swApp?.CloseDoc(filePath);
            }
            catch { }
        }

        private swDocumentTypes_e GetDocumentType(string filePath)
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

        #region BOM / References

        /// <summary>
        /// Get Bill of Materials from an assembly
        /// </summary>
        public CommandResult GetBillOfMaterials(string? filePath, bool includeChildren = true, string? configuration = null)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            if (ext != ".sldasm")
                return new CommandResult { Success = false, Error = "BOM extraction only works on assembly files (.sldasm)" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var assembly = (AssemblyDoc)doc;
                var bom = new List<BomItem>();
                
                // Get active configuration if not specified
                var configName = configuration ?? doc.ConfigurationManager.ActiveConfiguration.Name;

                // Get all components
                var components = (object[])assembly.GetComponents(false); // false = all levels
                var quantities = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

                if (components != null)
                {
                    foreach (Component2 comp in components)
                    {
                        if (comp.IsSuppressed()) continue;

                        var compPath = comp.GetPathName();
                        if (string.IsNullOrEmpty(compPath)) continue;

                        // Count quantities
                        if (quantities.ContainsKey(compPath))
                            quantities[compPath]++;
                        else
                            quantities[compPath] = 1;
                    }

                    // Build BOM with unique parts and their quantities
                    var processed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    
                    foreach (Component2 comp in components)
                    {
                        if (comp.IsSuppressed()) continue;

                        var compPath = comp.GetPathName();
                        if (string.IsNullOrEmpty(compPath) || processed.Contains(compPath)) continue;
                        processed.Add(compPath);

                        var fileName = Path.GetFileName(compPath);
                        var compExt = Path.GetExtension(compPath).ToLowerInvariant();
                        
                        // Get properties from component
                        var props = new Dictionary<string, string>();
                        var compDoc = comp.GetModelDoc2() as ModelDoc2;
                        if (compDoc != null)
                        {
                            props = ReadCustomProperties(compDoc, comp.ReferencedConfiguration);
                        }

                        bom.Add(new BomItem
                        {
                            FileName = fileName,
                            FilePath = compPath,
                            FileType = compExt == ".sldprt" ? "Part" : compExt == ".sldasm" ? "Assembly" : "Other",
                            Quantity = quantities[compPath],
                            Configuration = comp.ReferencedConfiguration,
                            PartNumber = GetPartNumber(props),
                            Description = GetDictValue(props, "Description") ?? "",
                            Material = GetDictValue(props, "Material") ?? "",
                            Revision = GetRevision(props),
                            Properties = props
                        });
                    }
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        assemblyPath = filePath,
                        configuration = configName,
                        items = bom,
                        totalParts = bom.Count,
                        totalQuantity = bom.Sum(b => b.Quantity)
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Get all external references from a file
        /// </summary>
        public CommandResult GetExternalReferences(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var references = new List<object>();
                var dependencies = (object[])doc.GetDependencies2(true, true, false);

                if (dependencies != null)
                {
                    // Dependencies come in pairs: [path, bool, path, bool, ...]
                    for (int i = 0; i < dependencies.Length; i += 2)
                    {
                        var refPath = dependencies[i] as string;
                        if (string.IsNullOrEmpty(refPath)) continue;

                        references.Add(new
                        {
                            path = refPath,
                            fileName = Path.GetFileName(refPath),
                            exists = File.Exists(refPath),
                            fileType = GetFileType(refPath!)
                        });
                    }
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        references,
                        count = references.Count
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        #endregion

        #region Custom Properties

        /// <summary>
        /// Get custom properties from a file
        /// </summary>
        public CommandResult GetCustomProperties(string? filePath, string? configuration = null)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var fileProps = ReadCustomProperties(doc, null);
                var configProps = new Dictionary<string, Dictionary<string, string>>();

                // Get configuration-specific properties (drawings may not have configurations)
                var configNamesObj = doc.GetConfigurationNames();
                var configNames = configNamesObj as string[] ?? Array.Empty<string>();
                foreach (var config in configNames)
                {
                    if (configuration == null || config == configuration)
                    {
                        try
                        {
                            configProps[config] = ReadCustomProperties(doc, config);
                        }
                        catch { } // Ignore errors reading config properties
                    }
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        fileProperties = fileProps,
                        configurationProperties = configProps,
                        configurations = configNames
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Set custom properties on a file
        /// </summary>
        public CommandResult SetCustomProperties(string? filePath, Dictionary<string, string>? properties, string? configuration = null)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            if (properties == null || properties.Count == 0)
                return new CommandResult { Success = false, Error = "Missing or empty 'properties'" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings, readOnly: false);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                WriteCustomProperties(doc, properties, configuration);

                // Save the document
                doc.Save3(
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    ref errors,
                    ref warnings
                );

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        propertiesSet = properties.Count,
                        configuration = configuration ?? "(file-level)"
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        private Dictionary<string, string> ReadCustomProperties(ModelDoc2 doc, string? configuration)
        {
            var props = new Dictionary<string, string>();

            try
            {
                var ext = doc?.Extension;
                if (ext == null) return props;
                
                var manager = string.IsNullOrEmpty(configuration)
                    ? ext.CustomPropertyManager[""]
                    : ext.CustomPropertyManager[configuration];

                if (manager == null) return props;

                object names = null!;
                object types = null!;
                object values = null!;
                object resolved = null!;
                object linkToProperty = null!;
                manager.GetAll3(ref names, ref types, ref values, ref resolved, ref linkToProperty);

                if (names is string[] nameArray && resolved is string[] resolvedArray)
                {
                    for (int i = 0; i < nameArray.Length; i++)
                    {
                        props[nameArray[i]] = resolvedArray[i] ?? "";
                    }
                }
            }
            catch { }

            return props;
        }

        private void WriteCustomProperties(ModelDoc2 doc, Dictionary<string, string> properties, string? configuration)
        {
            var ext = doc.Extension;
            var manager = string.IsNullOrEmpty(configuration)
                ? ext.CustomPropertyManager[""]
                : ext.CustomPropertyManager[configuration];

            foreach (var prop in properties)
            {
                // Try to set existing property first, then add if it doesn't exist
                var result = manager.Set2(prop.Key, prop.Value);
                if (result != (int)swCustomInfoSetResult_e.swCustomInfoSetResult_OK)
                {
                    manager.Add3(prop.Key, (int)swCustomInfoType_e.swCustomInfoText, prop.Value, 
                        (int)swCustomPropertyAddOption_e.swCustomPropertyDeleteAndAdd);
                }
            }
        }

        #endregion

        #region Configurations

        /// <summary>
        /// Get all configurations from a file
        /// </summary>
        public CommandResult GetConfigurations(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var configs = new List<object>();
                var configNames = (string[])doc.GetConfigurationNames();
                var activeConfig = doc.ConfigurationManager.ActiveConfiguration?.Name ?? "";

                foreach (var name in configNames)
                {
                    var config = (Configuration)doc.GetConfigurationByName(name);
                    var props = ReadCustomProperties(doc, name);
                    
                    configs.Add(new
                    {
                        name,
                        isActive = name == activeConfig,
                        description = config?.Description ?? "",
                        properties = props
                    });
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        activeConfiguration = activeConfig,
                        configurations = configs,
                        count = configs.Count
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        #endregion

        #region Mass Properties

        /// <summary>
        /// Get mass properties from a part or assembly
        /// </summary>
        public CommandResult GetMassProperties(string? filePath, string? configuration = null)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                if (!string.IsNullOrEmpty(configuration))
                {
                    doc.ShowConfiguration2(configuration);
                    doc.EditRebuild3();
                }

                var massProps = (double[])doc.Extension.GetMassProperties2(1, out var status, true);

                if (massProps == null || status != 0)
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = "Failed to get mass properties. Ensure the model has assigned materials."
                    };
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        configuration = configuration ?? "Active",
                        mass = massProps[5], // kg
                        volume = massProps[3], // m^3
                        surfaceArea = massProps[4], // m^2
                        centerOfMass = new { x = massProps[0], y = massProps[1], z = massProps[2] },
                        momentsOfInertia = new { 
                            Ixx = massProps[6], Iyy = massProps[7], Izz = massProps[8],
                            Ixy = massProps[9], Izx = massProps[10], Iyz = massProps[11]
                        }
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        #endregion

        #region Export Operations

        /// <summary>
        /// Export a drawing to PDF
        /// </summary>
        public CommandResult ExportToPdf(string? filePath, string? outputPath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            ISldWorks? sw = null;
            try
            {
                sw = GetSolidWorks();
                int errors = 0, warnings = 0;

                doc = (ModelDoc2)sw.OpenDoc6(
                    filePath,
                    (int)swDocumentTypes_e.swDocDRAWING,
                    (int)swOpenDocOptions_e.swOpenDocOptions_Silent,
                    "",
                    ref errors,
                    ref warnings
                );

                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open drawing: errors={errors}" };

                var finalOutputPath = outputPath ?? Path.ChangeExtension(filePath, ".pdf");
                Directory.CreateDirectory(Path.GetDirectoryName(finalOutputPath)!);

                // Set PDF export options
                var exportData = (ExportPdfData)sw.GetExportFileData((int)swExportDataFileType_e.swExportPdfData);
                var drawDoc = (DrawingDoc)doc;
                var sheetNames = (string[])drawDoc.GetSheetNames();
                exportData.SetSheets((int)swExportDataSheetsToExport_e.swExportData_ExportAllSheets, sheetNames);
                exportData.ViewPdfAfterSaving = false;

                bool success = doc.Extension.SaveAs3(
                    finalOutputPath,
                    (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    exportData,
                    null,
                    ref errors,
                    ref warnings
                );

                if (!success)
                    return new CommandResult { Success = false, Error = $"PDF export failed: errors={errors}" };

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        inputFile = filePath,
                        outputFile = finalOutputPath,
                        fileSize = new FileInfo(finalOutputPath).Length
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null && sw != null)
                {
                    try { sw.CloseDoc(filePath); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Export to STEP format
        /// </summary>
        public CommandResult ExportToStep(string? filePath, string? outputPath, string? configuration, bool exportAllConfigs, string[]? configurations = null, string? filenamePattern = null)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            ISldWorks? sw = null;
            try
            {
                sw = GetSolidWorks();
                var ext = Path.GetExtension(filePath).ToLowerInvariant();
                var docType = ext == ".sldprt" ? swDocumentTypes_e.swDocPART : swDocumentTypes_e.swDocASSEMBLY;

                int errors = 0, warnings = 0;
                doc = (ModelDoc2)sw.OpenDoc6(
                    filePath,
                    (int)docType,
                    (int)swOpenDocOptions_e.swOpenDocOptions_Silent,
                    "",
                    ref errors,
                    ref warnings
                );

                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var exportedFiles = new List<string>();
                var baseName = Path.GetFileNameWithoutExtension(filePath);
                var outputDir = Path.GetDirectoryName(outputPath ?? filePath)!;
                Directory.CreateDirectory(outputDir);

                // Determine which configs to export
                string[] configsToExport;
                if (configurations != null && configurations.Length > 0)
                {
                    // Export specific configurations
                    configsToExport = configurations;
                }
                else if (exportAllConfigs)
                {
                    // Export all configurations
                    configsToExport = (string[])doc.GetConfigurationNames();
                }
                else if (!string.IsNullOrEmpty(configuration))
                {
                    // Export single configuration
                    configsToExport = new[] { configuration };
                }
                else
                {
                    // Export active configuration only
                    configsToExport = new string[0];
                }

                if (configsToExport.Length > 0)
                {
                    foreach (var configName in configsToExport)
                    {
                        doc.ShowConfiguration2(configName);
                        doc.EditRebuild3();

                        // Build output filename
                        string configOutputPath;
                        if (!string.IsNullOrEmpty(filenamePattern))
                        {
                            // Get properties for pattern replacement
                            var props = GetConfigProperties(doc, configName);
                            var fileName = FormatExportFilename(filenamePattern, baseName, configName, props, ".step");
                            configOutputPath = Path.Combine(outputDir, fileName);
                        }
                        else
                        {
                            configOutputPath = Path.Combine(outputDir, $"{baseName}_{configName}.step");
                        }

                        bool success = doc.Extension.SaveAs3(
                            configOutputPath,
                            (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                            (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                            null, null,
                            ref errors, ref warnings
                        );

                        if (success)
                            exportedFiles.Add(configOutputPath);
                    }
                }
                else
                {
                    // No specific config - export current/active
                    var finalOutputPath = outputPath ?? Path.ChangeExtension(filePath, ".step");
                    Directory.CreateDirectory(Path.GetDirectoryName(finalOutputPath)!);

                    bool success = doc.Extension.SaveAs3(
                        finalOutputPath,
                        (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                        (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                        null, null,
                        ref errors, ref warnings
                    );

                    if (success)
                        exportedFiles.Add(finalOutputPath);
                }

                return new CommandResult
                {
                    Success = exportedFiles.Count > 0,
                    Data = new
                    {
                        inputFile = filePath,
                        exportedFiles,
                        count = exportedFiles.Count
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null && sw != null)
                {
                    try { sw.CloseDoc(filePath); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Export to IGES format
        /// </summary>
        public CommandResult ExportToIges(string? filePath, string? outputPath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var finalOutputPath = outputPath ?? Path.ChangeExtension(filePath, ".igs");
                Directory.CreateDirectory(Path.GetDirectoryName(finalOutputPath)!);

                bool success = doc.Extension.SaveAs3(
                    finalOutputPath,
                    (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    null, null,
                    ref errors, ref warnings
                );

                if (!success)
                    return new CommandResult { Success = false, Error = $"IGES export failed: errors={errors}" };

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        inputFile = filePath,
                        outputFile = finalOutputPath,
                        fileSize = new FileInfo(finalOutputPath).Length
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Export drawing to DXF
        /// </summary>
        public CommandResult ExportToDxf(string? filePath, string? outputPath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var finalOutputPath = outputPath ?? Path.ChangeExtension(filePath, ".dxf");
                Directory.CreateDirectory(Path.GetDirectoryName(finalOutputPath)!);

                bool success = doc.Extension.SaveAs3(
                    finalOutputPath,
                    (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    null, null,
                    ref errors, ref warnings
                );

                if (!success)
                    return new CommandResult { Success = false, Error = $"DXF export failed: errors={errors}" };

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        inputFile = filePath,
                        outputFile = finalOutputPath,
                        fileSize = new FileInfo(finalOutputPath).Length
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Export model view to image
        /// </summary>
        public CommandResult ExportToImage(string? filePath, string? outputPath, int width = 800, int height = 600)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var errors, out var warnings);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}" };

                var finalOutputPath = outputPath ?? Path.ChangeExtension(filePath, ".png");
                Directory.CreateDirectory(Path.GetDirectoryName(finalOutputPath)!);

                // Use SaveAs with image format
                int saveErrors = 0, saveWarnings = 0;
                bool success = doc.Extension.SaveAs2(
                    finalOutputPath,
                    (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    null,
                    "",
                    false,
                    ref saveErrors,
                    ref saveWarnings
                );

                return new CommandResult
                {
                    Success = success && File.Exists(finalOutputPath),
                    Data = new
                    {
                        inputFile = filePath,
                        outputFile = finalOutputPath,
                        width,
                        height,
                        fileSize = File.Exists(finalOutputPath) ? new FileInfo(finalOutputPath).Length : 0
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(filePath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        #endregion

        #region Assembly Operations

        /// <summary>
        /// Replace a component in an assembly
        /// </summary>
        public CommandResult ReplaceComponent(string? assemblyPath, string? oldComponent, string? newComponent)
        {
            if (string.IsNullOrEmpty(assemblyPath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (string.IsNullOrEmpty(oldComponent) || string.IsNullOrEmpty(newComponent))
                return new CommandResult { Success = false, Error = "Missing 'oldComponent' or 'newComponent'" };

            if (!File.Exists(newComponent))
                return new CommandResult { Success = false, Error = $"New component not found: {newComponent}" };

            ModelDoc2? doc = null;
            try
            {
                doc = OpenDocument(assemblyPath!, out var errors, out var warnings, readOnly: false);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open assembly: errors={errors}" };

                var assembly = (AssemblyDoc)doc;
                var components = (object[])assembly.GetComponents(false);
                int replacedCount = 0;

                foreach (Component2 comp in components)
                {
                    var compPath = comp.GetPathName();
                    if (string.Equals(compPath, oldComponent, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(Path.GetFileName(compPath), Path.GetFileName(oldComponent), StringComparison.OrdinalIgnoreCase))
                    {
                        comp.Select4(true, null, false);

                        bool replaced = assembly.ReplaceComponents2(
                            newComponent,
                            "", // Use active configuration
                            false, // Keep mates
                            (int)swReplaceComponentsConfiguration_e.swReplaceComponentsConfiguration_MatchName,
                            true
                        );

                        if (replaced)
                            replacedCount++;

                        doc.ClearSelection2(true);
                    }
                }

                doc.Save3(
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    ref errors, ref warnings
                );

                return new CommandResult
                {
                    Success = replacedCount > 0,
                    Data = new
                    {
                        assemblyPath,
                        oldComponent,
                        newComponent,
                        replacedCount
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { CloseDocument(assemblyPath!); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        /// <summary>
        /// Pack and Go - copy assembly with all references
        /// </summary>
        public CommandResult PackAndGo(string? filePath, string? outputFolder, string? prefix, string? suffix)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (string.IsNullOrEmpty(outputFolder))
                return new CommandResult { Success = false, Error = "Missing 'outputFolder'" };

            ModelDoc2? doc = null;
            ISldWorks? sw = null;
            try
            {
                sw = GetSolidWorks();
                int errors = 0, warnings = 0;

                doc = (ModelDoc2)sw.OpenDoc6(
                    filePath,
                    (int)swDocumentTypes_e.swDocASSEMBLY,
                    (int)swOpenDocOptions_e.swOpenDocOptions_Silent,
                    "",
                    ref errors, ref warnings
                );

                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open assembly: errors={errors}" };

                Directory.CreateDirectory(outputFolder);

                var packAndGo = (PackAndGo)doc.Extension.GetPackAndGo();
                packAndGo.IncludeDrawings = true;
                packAndGo.IncludeSimulationResults = false;
                packAndGo.IncludeToolboxComponents = true;
                packAndGo.FlattenToSingleFolder = true;
                packAndGo.SetSaveToName(true, outputFolder);

                object fileNamesObj = null!;
                packAndGo.GetDocumentNames(out fileNamesObj);
                var fileNames = (object[])fileNamesObj;
                var newNames = new string[fileNames.Length];

                for (int i = 0; i < fileNames.Length; i++)
                {
                    var originalName = Path.GetFileNameWithoutExtension((string)fileNames[i]);
                    var extension = Path.GetExtension((string)fileNames[i]);
                    var newName = $"{prefix ?? ""}{originalName}{suffix ?? ""}{extension}";
                    newNames[i] = Path.Combine(outputFolder, newName);
                }

                packAndGo.SetDocumentSaveToNames(newNames);
                var statuses = (int[])doc.Extension.SavePackAndGo(packAndGo);

                int successCount = 0;
                var copiedFiles = new List<string>();
                for (int i = 0; i < statuses.Length; i++)
                {
                    if (statuses[i] == 0)
                    {
                        successCount++;
                        copiedFiles.Add(newNames[i]);
                    }
                }

                return new CommandResult
                {
                    Success = successCount > 0,
                    Data = new
                    {
                        sourceFile = filePath,
                        outputFolder,
                        totalFiles = fileNames.Length,
                        copiedFiles = successCount,
                        files = copiedFiles
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null && sw != null)
                {
                    try { sw.CloseDoc(filePath); } catch { }
                }
                CloseSolidWorksIfWeStartedIt();
            }
        }

        #endregion

        #region Helpers

        private string GetFileType(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            return ext switch
            {
                ".sldprt" => "Part",
                ".sldasm" => "Assembly",
                ".slddrw" => "Drawing",
                _ => "Other"
            };
        }

        /// <summary>
        /// Safe dictionary value getter (replacement for GetValueOrDefault in .NET 4.8)
        /// </summary>
        private static string? GetDictValue(Dictionary<string, string> dict, string key)
        {
            if (dict.TryGetValue(key, out var value))
                return value;
            return null;
        }

        /// <summary>
        /// Get part number from properties, checking common property name variations
        /// </summary>
        private static string GetPartNumber(Dictionary<string, string> props)
        {
            // Common part number property names used in SolidWorks
            string[] partNumberKeys = {
                "PartNumber", "Part Number", "Part No", "Part No.", "PartNo",
                "ItemNumber", "Item Number", "Item No", "Item No.", "ItemNo",
                "PN", "P/N", "Number", "No", "No."
            };

            foreach (var key in partNumberKeys)
            {
                var value = GetDictValue(props, key);
                if (value != null && value.Length > 0)
                    return value;
            }

            // Try case-insensitive search as fallback
            foreach (var kvp in props)
            {
                var lowerKey = kvp.Key.ToLowerInvariant();
                if (lowerKey.Contains("part") && (lowerKey.Contains("number") || lowerKey.Contains("no")) ||
                    lowerKey.Contains("item") && (lowerKey.Contains("number") || lowerKey.Contains("no")) ||
                    lowerKey == "pn" || lowerKey == "p/n")
                {
                    if (!string.IsNullOrEmpty(kvp.Value))
                        return kvp.Value;
                }
            }

            return "";
        }

        /// <summary>
        /// Get revision from properties, checking common property name variations
        /// </summary>
        private static string GetRevision(Dictionary<string, string> props)
        {
            // Common revision property names used in SolidWorks
            string[] revisionKeys = {
                "Revision", "Rev", "Rev.", "REV", "RevLevel", "Rev Level",
                "Revision Level", "RevisionLevel", "ECO", "ECN", "Change Level"
            };

            foreach (var key in revisionKeys)
            {
                var value = GetDictValue(props, key);
                if (value != null && value.Length > 0)
                    return value;
            }

            // Try case-insensitive search as fallback
            foreach (var kvp in props)
            {
                var lowerKey = kvp.Key.ToLowerInvariant();
                if (lowerKey.Contains("rev") || lowerKey.Contains("eco") || lowerKey.Contains("ecn"))
                {
                    if (!string.IsNullOrEmpty(kvp.Value))
                        return kvp.Value;
                }
            }

            return "";
        }

        /// <summary>
        /// Get custom properties from a configuration for export filename formatting
        /// </summary>
        private Dictionary<string, string> GetConfigProperties(ModelDoc2 doc, string configName)
        {
            var props = new Dictionary<string, string>();
            try
            {
                var manager = doc.Extension.CustomPropertyManager[configName];
                if (manager == null)
                    manager = doc.Extension.CustomPropertyManager[""];
                
                if (manager != null)
                {
                    object names = null, values = null, resolved = null, types = null;
                    manager.GetAll2(ref names, ref types, ref values, ref resolved);
                    
                    var propNames = names as string[];
                    var propResolved = resolved as string[];
                    
                    if (propNames != null && propResolved != null)
                    {
                        for (int i = 0; i < propNames.Length && i < propResolved.Length; i++)
                        {
                            var name = propNames[i];
                            var value = propResolved[i];
                            if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(value))
                            {
                                props[name] = value;
                            }
                        }
                    }
                }
            }
            catch
            {
                // Ignore property read errors
            }
            return props;
        }

        /// <summary>
        /// Format export filename using a pattern with placeholders
        /// Supported placeholders:
        /// {filename} - Original file name (without extension)
        /// {config} - Configuration name
        /// {partNumber} or {number} - Part/Item number from properties
        /// {revision} or {rev} - Revision from properties
        /// {description} or {desc} - Description from properties
        /// {date} - Current date (YYYY-MM-DD)
        /// {time} - Current time (HH-MM-SS)
        /// {datetime} - Current date and time (YYYY-MM-DD_HH-MM-SS)
        /// </summary>
        private string FormatExportFilename(string pattern, string baseName, string configName, Dictionary<string, string> props, string extension)
        {
            var now = DateTime.Now;
            
            // Get property values
            var partNumber = GetPartNumber(props);
            var revision = GetRevision(props);
            var description = GetDictValue(props, "Description") ?? GetDictValue(props, "DESCRIPTION") ?? "";
            
            // Replace placeholders (case-insensitive)
            var result = pattern;
            result = ReplaceIgnoreCase(result, "{filename}", baseName);
            result = ReplaceIgnoreCase(result, "{config}", configName);
            result = ReplaceIgnoreCase(result, "{partNumber}", partNumber);
            result = ReplaceIgnoreCase(result, "{number}", partNumber);
            result = ReplaceIgnoreCase(result, "{revision}", revision);
            result = ReplaceIgnoreCase(result, "{rev}", revision);
            result = ReplaceIgnoreCase(result, "{description}", description);
            result = ReplaceIgnoreCase(result, "{desc}", description);
            result = ReplaceIgnoreCase(result, "{date}", now.ToString("yyyy-MM-dd"));
            result = ReplaceIgnoreCase(result, "{time}", now.ToString("HH-mm-ss"));
            result = ReplaceIgnoreCase(result, "{datetime}", now.ToString("yyyy-MM-dd_HH-mm-ss"));
            
            // Clean up invalid filename characters
            foreach (char c in Path.GetInvalidFileNameChars())
            {
                result = result.Replace(c, '_');
            }
            
            // Ensure extension
            if (!result.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            {
                result += extension;
            }
            
            return result;
        }

        private static string ReplaceIgnoreCase(string source, string oldValue, string newValue)
        {
            int index = source.IndexOf(oldValue, StringComparison.OrdinalIgnoreCase);
            while (index >= 0)
            {
                source = source.Substring(0, index) + newValue + source.Substring(index + oldValue.Length);
                index = source.IndexOf(oldValue, index + newValue.Length, StringComparison.OrdinalIgnoreCase);
            }
            return source;
        }

        #endregion

        #region Open Document Management

        /// <summary>
        /// Get list of currently open documents in SolidWorks
        /// </summary>
        public CommandResult GetOpenDocuments()
        {
            try
            {
                // Only try to connect to running instance, don't start SW
                ISldWorks? sw = null;
                try
                {
                    sw = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
                }
                catch
                {
                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            solidWorksRunning = false,
                            documents = new List<object>()
                        }
                    };
                }

                var documents = new List<object>();
                var doc = (ModelDoc2)sw.GetFirstDocument();

                while (doc != null)
                {
                    var filePath = doc.GetPathName();
                    if (!string.IsNullOrEmpty(filePath))
                    {
                        documents.Add(new
                        {
                            filePath,
                            fileName = Path.GetFileName(filePath),
                            fileType = GetFileType(filePath),
                            isReadOnly = doc.IsOpenedReadOnly(),
                            isDirty = doc.GetSaveFlag(), // true if has unsaved changes
                            activeConfiguration = doc.ConfigurationManager?.ActiveConfiguration?.Name ?? ""
                        });
                    }
                    doc = (ModelDoc2)doc.GetNext();
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        solidWorksRunning = true,
                        documents,
                        count = documents.Count
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        /// <summary>
        /// Check if a specific file is open in SolidWorks
        /// </summary>
        public CommandResult IsDocumentOpen(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            try
            {
                ISldWorks? sw = null;
                try
                {
                    sw = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
                }
                catch
                {
                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            isOpen = false,
                            solidWorksRunning = false
                        }
                    };
                }

                var doc = (ModelDoc2)sw.GetOpenDocument(filePath);
                var isOpen = doc != null;

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        isOpen,
                        solidWorksRunning = true,
                        isReadOnly = isOpen ? doc!.IsOpenedReadOnly() : (bool?)null,
                        isDirty = isOpen ? doc!.GetSaveFlag() : (bool?)null
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        /// <summary>
        /// Set read-only state of an open document.
        /// This allows checking out a file without closing SolidWorks!
        /// </summary>
        public CommandResult SetDocumentReadOnly(string? filePath, bool readOnly)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            try
            {
                ISldWorks? sw = null;
                try
                {
                    sw = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
                }
                catch
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = "SolidWorks is not running"
                    };
                }

                var doc = (ModelDoc2)sw.GetOpenDocument(filePath);
                if (doc == null)
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = $"File is not open in SolidWorks: {Path.GetFileName(filePath)}"
                    };
                }

                // Check current state
                var wasReadOnly = doc.IsOpenedReadOnly();
                
                // Set the new state
                doc.SetReadOnlyState(readOnly);

                // Verify the change
                var isNowReadOnly = doc.IsOpenedReadOnly();

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        fileName = Path.GetFileName(filePath),
                        wasReadOnly,
                        isNowReadOnly,
                        readOnly,
                        changed = wasReadOnly != isNowReadOnly
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        /// <summary>
        /// Save an open document. Useful before check-in.
        /// </summary>
        public CommandResult SaveDocument(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            try
            {
                ISldWorks? sw = null;
                try
                {
                    sw = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
                }
                catch
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = "SolidWorks is not running"
                    };
                }

                var doc = (ModelDoc2)sw.GetOpenDocument(filePath);
                if (doc == null)
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = $"File is not open in SolidWorks: {Path.GetFileName(filePath)}"
                    };
                }

                // Check if document has unsaved changes
                var wasDirty = doc.GetSaveFlag();
                
                if (!wasDirty)
                {
                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            fileName = Path.GetFileName(filePath),
                            saved = false,
                            reason = "No unsaved changes"
                        }
                    };
                }

                // Check if document is read-only
                if (doc.IsOpenedReadOnly())
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = $"Cannot save: document is read-only. Check out the file first."
                    };
                }

                int errors = 0, warnings = 0;
                doc.Save3(
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    ref errors,
                    ref warnings
                );

                if (errors != 0)
                {
                    return new CommandResult
                    {
                        Success = false,
                        Error = $"Save failed with error code: {errors}"
                    };
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        fileName = Path.GetFileName(filePath),
                        saved = true,
                        warnings
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        /// <summary>
        /// Get detailed info about an open document including dirty state
        /// </summary>
        public CommandResult GetDocumentInfo(string? filePath)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            try
            {
                ISldWorks? sw = null;
                try
                {
                    sw = (ISldWorks)Marshal.GetActiveObject("SldWorks.Application");
                }
                catch
                {
                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            solidWorksRunning = false,
                            isOpen = false
                        }
                    };
                }

                var doc = (ModelDoc2)sw.GetOpenDocument(filePath);
                if (doc == null)
                {
                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            solidWorksRunning = true,
                            isOpen = false
                        }
                    };
                }

                var props = ReadCustomProperties(doc, null);

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        fileName = Path.GetFileName(filePath),
                        solidWorksRunning = true,
                        isOpen = true,
                        isReadOnly = doc.IsOpenedReadOnly(),
                        isDirty = doc.GetSaveFlag(),
                        fileType = GetFileType(filePath!),
                        activeConfiguration = doc.ConfigurationManager?.ActiveConfiguration?.Name ?? "",
                        properties = props
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        #endregion

        #region Preview Extraction

        /// <summary>
        /// Get preview image from a SolidWorks file using the full SolidWorks API.
        /// This is slower than Document Manager but works with newer file formats.
        /// </summary>
        public CommandResult GetPreviewImage(string? filePath, string? configuration = null)
        {
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "File path is required" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            try
            {
                var sw = GetSolidWorks();
                
                // Check if file is already open
                var openDoc = sw.IGetOpenDocumentByName2(filePath) as ModelDoc2;
                bool weOpenedIt = false;
                
                if (openDoc == null)
                {
                    // Open the file in read-only mode with light-weight assembly
                    int errors = 0, warnings = 0;
                    
                    // Determine document type
                    var ext = Path.GetExtension(filePath).ToUpperInvariant();
                    swDocumentTypes_e docType = ext switch
                    {
                        ".SLDPRT" => swDocumentTypes_e.swDocPART,
                        ".SLDASM" => swDocumentTypes_e.swDocASSEMBLY,
                        ".SLDDRW" => swDocumentTypes_e.swDocDRAWING,
                        _ => throw new Exception($"Unsupported file type: {ext}")
                    };
                    
                    // Open with options: read-only, silent, invisible
                    int openOptions = (int)(swOpenDocOptions_e.swOpenDocOptions_ReadOnly | 
                                           swOpenDocOptions_e.swOpenDocOptions_Silent);
                    
                    openDoc = sw.OpenDoc6(filePath, (int)docType, openOptions, 
                                         configuration ?? "", ref errors, ref warnings) as ModelDoc2;
                    
                    if (openDoc == null)
                        return new CommandResult { Success = false, Error = $"Failed to open file: errors={errors}, warnings={warnings}" };
                    
                    weOpenedIt = true;
                }
                
                try
                {
                    // Activate the target configuration if specified
                    if (!string.IsNullOrEmpty(configuration))
                    {
                        openDoc.ShowConfiguration2(configuration);
                    }
                    
                    // Get the preview using SaveBMP to a temp file
                    string tempPath = Path.Combine(Path.GetTempPath(), $"preview_{Guid.NewGuid()}.bmp");
                    byte[]? imageData = null;
                    string mimeType = "image/bmp";
                    
                    // Different sizes for different file types
                    var ext = Path.GetExtension(filePath).ToUpperInvariant();
                    int width, height;
                    
                    if (ext == ".SLDDRW")
                    {
                        // Drawings: Use higher res, landscape for sheets (most drawings are landscape)
                        width = 1600;
                        height = 1200;
                    }
                    else
                    {
                        // Parts/Assemblies: 3D view
                        width = 1024;
                        height = 768;
                    }
                    
                    try
                    {
                        if (ext == ".SLDPRT" || ext == ".SLDASM")
                        {
                            // Zoom to fit for best preview
                            openDoc.ViewZoomtofit2();
                            
                            // Save as bitmap
                            bool result = openDoc.SaveBMP(tempPath, width, height);
                            if (result && File.Exists(tempPath))
                            {
                                imageData = File.ReadAllBytes(tempPath);
                            }
                        }
                        else if (ext == ".SLDDRW")
                        {
                            var drawDoc = openDoc as DrawingDoc;
                            
                            if (drawDoc != null)
                            {
                                // Get sheet size for proper aspect ratio
                                var sheet = drawDoc.GetCurrentSheet() as Sheet;
                                if (sheet != null)
                                {
                                    double sheetWidth = 0, sheetHeight = 0;
                                    sheet.GetSize(ref sheetWidth, ref sheetHeight);
                                    
                                    if (sheetWidth > 0 && sheetHeight > 0)
                                    {
                                        // Calculate aspect ratio matching the sheet
                                        double aspectRatio = sheetWidth / sheetHeight;
                                        
                                        // Use higher resolution for drawings
                                        if (aspectRatio >= 1.0) // Landscape
                                        {
                                            width = 2000;
                                            height = (int)(2000 / aspectRatio);
                                        }
                                        else // Portrait
                                        {
                                            height = 2000;
                                            width = (int)(2000 * aspectRatio);
                                        }
                                    }
                                }
                            }
                            
                            // Zoom to fit the drawing sheet
                            openDoc.ViewZoomtofit2();
                            
                            // Save as bitmap with sheet's aspect ratio
                            bool result = openDoc.SaveBMP(tempPath, width, height);
                            if (result && File.Exists(tempPath))
                            {
                                imageData = File.ReadAllBytes(tempPath);
                            }
                        }
                    }
                    finally
                    {
                        // Clean up temp file
                        try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
                    }
                    
                    if (imageData == null || imageData.Length == 0)
                        return new CommandResult { Success = false, Error = "Could not capture preview from document" };
                    
                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            configuration = openDoc.ConfigurationManager?.ActiveConfiguration?.Name ?? "",
                            imageData = Convert.ToBase64String(imageData),
                            mimeType,
                            width,
                            height,
                            sizeBytes = imageData.Length
                        }
                    };
                }
                finally
                {
                    // Close the document if we opened it
                    if (weOpenedIt && openDoc != null)
                    {
                        sw.CloseDoc(openDoc.GetTitle());
                    }
                }
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = $"Preview extraction failed: {ex.Message}" };
            }
        }

        #endregion

        #region IDisposable

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            if (_weStartedSW && _swApp != null)
            {
                try { _swApp.ExitApp(); } catch { }
            }

            _swApp = null;
            GC.Collect();
        }

        #endregion
    }

    /// <summary>
    /// BOM item data structure
    /// </summary>
    public class BomItem
    {
        public string FileName { get; set; } = "";
        public string FilePath { get; set; } = "";
        public string FileType { get; set; } = "";
        public int Quantity { get; set; } = 1;
        public string Configuration { get; set; } = "";
        public string PartNumber { get; set; } = "";
        public string Description { get; set; } = "";
        public string Material { get; set; } = "";
        public string Revision { get; set; } = "";
        public Dictionary<string, string> Properties { get; set; } = new();
    }
}

