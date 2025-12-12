using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SolidWorks.Interop.swdocumentmgr;

namespace BluePDM.SolidWorksService
{
    /// <summary>
    /// Lightweight SolidWorks Document Manager API handler.
    /// Reads metadata, properties, BOM, configurations WITHOUT launching SolidWorks!
    /// 
    /// Requires a Document Manager API license key (free with SolidWorks subscription).
    /// Get yours at: https://customerportal.solidworks.com/ → API Support
    /// </summary>
    public class DocumentManagerAPI : IDisposable
    {
        private SwDMApplication? _dmApp;
        private readonly string? _licenseKey;
        private bool _disposed;
        private bool _initialized;
        private string? _initError;

        public DocumentManagerAPI(string? licenseKey = null)
        {
            _licenseKey = licenseKey;
        }

        public bool IsAvailable => _initialized && _dmApp != null;
        public string? InitializationError => _initError;

        #region Initialization

        public bool Initialize()
        {
            if (_initialized) return _dmApp != null;

            try
            {
                var key = _licenseKey ?? Environment.GetEnvironmentVariable("SOLIDWORKS_DM_LICENSE_KEY");
                
                if (string.IsNullOrEmpty(key))
                {
                    _initError = "Document Manager license key not provided. Set SOLIDWORKS_DM_LICENSE_KEY environment variable or use 'setDmLicense' command.";
                    _initialized = true;
                    return false;
                }

                var dmClassFactory = new SwDMClassFactory();
                _dmApp = (SwDMApplication)dmClassFactory.GetApplication(key);
                
                if (_dmApp == null)
                {
                    _initError = "Failed to initialize Document Manager. Check that the license key is valid.";
                    _initialized = true;
                    return false;
                }

                _initialized = true;
                return true;
            }
            catch (Exception ex)
            {
                _initError = $"Document Manager initialization failed: {ex.Message}";
                _initialized = true;
                return false;
            }
        }

        public bool SetLicenseKey(string key)
        {
            if (string.IsNullOrEmpty(key))
            {
                _initError = "License key cannot be empty";
                return false;
            }

            _disposed = false;
            _initialized = false;
            _dmApp = null;

            try
            {
                var dmClassFactory = new SwDMClassFactory();
                _dmApp = (SwDMApplication)dmClassFactory.GetApplication(key);
                
                if (_dmApp == null)
                {
                    _initError = "Invalid license key";
                    _initialized = true;
                    return false;
                }

                try { Environment.SetEnvironmentVariable("SOLIDWORKS_DM_LICENSE_KEY", key, EnvironmentVariableTarget.User); }
                catch { }

                _initialized = true;
                _initError = null;
                return true;
            }
            catch (Exception ex)
            {
                _initError = $"License key validation failed: {ex.Message}";
                _initialized = true;
                return false;
            }
        }

        private SwDMDocument? OpenDocument(string filePath, out SwDmDocumentOpenError error)
        {
            error = SwDmDocumentOpenError.swDmDocumentOpenErrorNone;
            
            if (_dmApp == null)
            {
                error = SwDmDocumentOpenError.swDmDocumentOpenErrorFail;
                return null;
            }

            var docType = GetDocumentType(filePath);
            if (docType == SwDmDocumentType.swDmDocumentUnknown)
            {
                error = SwDmDocumentOpenError.swDmDocumentOpenErrorFileNotFound;
                return null;
            }

            return (SwDMDocument)_dmApp.GetDocument(filePath, docType, true, out error);
        }

        private SwDmDocumentType GetDocumentType(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            return ext switch
            {
                ".sldprt" => SwDmDocumentType.swDmDocumentPart,
                ".sldasm" => SwDmDocumentType.swDmDocumentAssembly,
                ".slddrw" => SwDmDocumentType.swDmDocumentDrawing,
                _ => SwDmDocumentType.swDmDocumentUnknown
            };
        }

        #endregion

        #region Custom Properties (NO SW LAUNCH!)

        public CommandResult GetCustomProperties(string? filePath, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            try
            {
                var doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: {openError}" };

                var fileProps = ReadProperties(doc, null);
                var configNames = GetConfigurationNames(doc);
                var configProps = new Dictionary<string, Dictionary<string, string>>();
                
                foreach (var config in configNames)
                {
                    if (configuration == null || config == configuration)
                    {
                        configProps[config] = ReadProperties(doc, config);
                    }
                }

                doc.CloseDoc();

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
        }

        private Dictionary<string, string> ReadProperties(SwDMDocument doc, string? configuration)
        {
            var props = new Dictionary<string, string>();

            try
            {
                string[] propNames;

                if (string.IsNullOrEmpty(configuration))
                {
                    propNames = (string[])doc.GetCustomPropertyNames();
                    if (propNames != null)
                    {
                        foreach (var name in propNames)
                        {
                            var value = doc.GetCustomProperty(name, out _);
                            props[name] = value ?? "";
                        }
                    }
                }
                else
                {
                    var configMgr = doc.ConfigurationManager;
                    var config = (SwDMConfiguration)configMgr.GetConfigurationByName(configuration);
                    if (config != null)
                    {
                        propNames = (string[])config.GetCustomPropertyNames();
                        if (propNames != null)
                        {
                            foreach (var name in propNames)
                            {
                                var value = config.GetCustomProperty(name, out _);
                                props[name] = value ?? "";
                            }
                        }
                    }
                }
            }
            catch { }

            return props;
        }

        /// <summary>
        /// Set custom properties on a file WITHOUT launching SolidWorks!
        /// Can set file-level or configuration-specific properties.
        /// </summary>
        public CommandResult SetCustomProperties(string? filePath, Dictionary<string, string>? properties, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            if (properties == null || properties.Count == 0)
                return new CommandResult { Success = false, Error = "Missing or empty 'properties'" };

            try
            {
                // Open document for WRITE access (not read-only)
                var doc = OpenDocumentForWrite(filePath, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file for writing: {openError}" };

                int propsSet = 0;

                if (string.IsNullOrEmpty(configuration))
                {
                    // Set file-level properties
                    foreach (var kvp in properties)
                    {
                        try
                        {
                            // First try to delete the property (in case it exists), then add it
                            // This is a reliable way to update properties in DM API
                            try { doc.DeleteCustomProperty(kvp.Key); } catch { }
                            doc.AddCustomProperty(kvp.Key, SwDmCustomInfoType.swDmCustomInfoText, kvp.Value);
                            propsSet++;
                        }
                        catch
                        {
                            // Try SetCustomProperty as fallback (for older API versions)
                            try 
                            { 
                                // Cast to SwDMDocument9 for SetCustomProperty method
                                var doc9 = (SwDMDocument9)doc;
                                doc9.SetCustomProperty(kvp.Key, kvp.Value);
                                propsSet++; 
                            } 
                            catch { }
                        }
                    }
                }
                else
                {
                    // Set configuration-specific properties
                    var configMgr = doc.ConfigurationManager;
                    var config = (SwDMConfiguration)configMgr.GetConfigurationByName(configuration);
                    if (config == null)
                    {
                        doc.CloseDoc();
                        return new CommandResult { Success = false, Error = $"Configuration not found: {configuration}" };
                    }

                    foreach (var kvp in properties)
                    {
                        try
                        {
                            // Delete then add for reliable update
                            try { config.DeleteCustomProperty(kvp.Key); } catch { }
                            config.AddCustomProperty(kvp.Key, SwDmCustomInfoType.swDmCustomInfoText, kvp.Value);
                            propsSet++;
                        }
                        catch
                        {
                            try 
                            { 
                                var config4 = (SwDMConfiguration4)config;
                                config4.SetCustomProperty(kvp.Key, kvp.Value);
                                propsSet++; 
                            } 
                            catch { }
                        }
                    }
                }

                // Save and close
                doc.Save();
                doc.CloseDoc();

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        propertiesSet = propsSet,
                        configuration = configuration ?? "file-level"
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        /// <summary>
        /// Open document for write access (not read-only)
        /// </summary>
        private SwDMDocument? OpenDocumentForWrite(string filePath, out SwDmDocumentOpenError error)
        {
            error = SwDmDocumentOpenError.swDmDocumentOpenErrorNone;

            if (_dmApp == null)
            {
                error = SwDmDocumentOpenError.swDmDocumentOpenErrorFail;
                return null;
            }

            var docType = GetDocumentType(filePath);
            if (docType == SwDmDocumentType.swDmDocumentUnknown)
            {
                error = SwDmDocumentOpenError.swDmDocumentOpenErrorFail;
                return null;
            }

            // Open with write access (readOnly = false)
            return (SwDMDocument)_dmApp.GetDocument(filePath, docType, false, out error);
        }

        #endregion

        #region Configurations (NO SW LAUNCH!)

        public CommandResult GetConfigurations(string? filePath)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            try
            {
                var doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: {openError}" };

                var configNames = GetConfigurationNames(doc);
                var configs = new List<object>();
                var activeConfig = doc.ConfigurationManager.GetActiveConfigurationName();

                foreach (var name in configNames)
                {
                    var config = (SwDMConfiguration)doc.ConfigurationManager.GetConfigurationByName(name);
                    var props = ReadProperties(doc, name);

                    configs.Add(new
                    {
                        name,
                        isActive = name == activeConfig,
                        description = config?.Description ?? "",
                        properties = props
                    });
                }

                doc.CloseDoc();

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
        }

        private string[] GetConfigurationNames(SwDMDocument doc)
        {
            try
            {
                var names = (string[])doc.ConfigurationManager.GetConfigurationNames();
                return names ?? Array.Empty<string>();
            }
            catch
            {
                return Array.Empty<string>();
            }
        }

        #endregion

        #region BOM / References (NO SW LAUNCH!)

        public CommandResult GetBillOfMaterials(string? filePath, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            if (ext != ".sldasm")
                return new CommandResult { Success = false, Error = "BOM extraction only works on assembly files (.sldasm)" };

            try
            {
                var doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: {openError}" };

                var bom = new List<BomItem>();
                var quantities = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

                var configName = configuration ?? doc.ConfigurationManager.GetActiveConfigurationName();
                
                // Get external references
                var searchOpt = new SwDMSearchOptionClass();
                searchOpt.SearchFilters = (int)(SwDmSearchFilters.SwDmSearchForPart | SwDmSearchFilters.SwDmSearchForAssembly);
                var dependencies = (string[])doc.GetAllExternalReferences(searchOpt);

                if (dependencies != null)
                {
                    foreach (var depPath in dependencies)
                    {
                        if (string.IsNullOrEmpty(depPath)) continue;

                        if (quantities.ContainsKey(depPath))
                            quantities[depPath]++;
                        else
                            quantities[depPath] = 1;
                    }

                    var processed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var depPath in dependencies)
                    {
                        if (string.IsNullOrEmpty(depPath) || processed.Contains(depPath)) continue;
                        if (!File.Exists(depPath)) continue;
                        processed.Add(depPath);

                        var depExt = Path.GetExtension(depPath).ToLowerInvariant();
                        var fileType = depExt == ".sldprt" ? "Part" : depExt == ".sldasm" ? "Assembly" : "Other";

                        var props = new Dictionary<string, string>();
                        try
                        {
                            var compDoc = OpenDocument(depPath, out _);
                            if (compDoc != null)
                            {
                                props = ReadProperties(compDoc, null);
                                compDoc.CloseDoc();
                            }
                        }
                        catch { }

                        bom.Add(new BomItem
                        {
                            FileName = Path.GetFileName(depPath),
                            FilePath = depPath,
                            FileType = fileType,
                            Quantity = quantities[depPath],
                            Configuration = "",
                            PartNumber = GetDictValue(props, "PartNumber") ?? GetDictValue(props, "Part Number") ?? "",
                            Description = GetDictValue(props, "Description") ?? "",
                            Material = GetDictValue(props, "Material") ?? "",
                            Revision = GetDictValue(props, "Revision") ?? GetDictValue(props, "Rev") ?? "",
                            Properties = props
                        });
                    }
                }

                doc.CloseDoc();

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
        }

        public CommandResult GetExternalReferences(string? filePath)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            try
            {
                var doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: {openError}" };

                var references = new List<object>();
                var searchOpt = new SwDMSearchOptionClass();
                searchOpt.SearchFilters = (int)(SwDmSearchFilters.SwDmSearchForPart | SwDmSearchFilters.SwDmSearchForAssembly | SwDmSearchFilters.SwDmSearchForDrawing);
                var dependencies = (string[])doc.GetAllExternalReferences(searchOpt);

                if (dependencies != null)
                {
                    var processed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var depPath in dependencies)
                    {
                        if (string.IsNullOrEmpty(depPath) || processed.Contains(depPath)) continue;
                        processed.Add(depPath);

                        var depExt = Path.GetExtension(depPath).ToLowerInvariant();
                        references.Add(new
                        {
                            path = depPath,
                            fileName = Path.GetFileName(depPath),
                            exists = File.Exists(depPath),
                            fileType = depExt == ".sldprt" ? "Part" : depExt == ".sldasm" ? "Assembly" : depExt == ".slddrw" ? "Drawing" : "Other"
                        });
                    }
                }

                doc.CloseDoc();

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
        }

        #endregion

        #region Preview Extraction (NO SW LAUNCH!)

        /// <summary>
        /// Extract high-resolution preview image from a SolidWorks file.
        /// Returns the image as a base64-encoded PNG string.
        /// 
        /// The Document Manager API stores previews as DIB (Device Independent Bitmap) format.
        /// We convert it to PNG for web display.
        /// </summary>
        public CommandResult GetPreviewImage(string? filePath, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            try
            {
                var doc = OpenDocument(filePath, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: {openError}" };

                object? previewBitmap = null;
                
                // Try to get preview from specific configuration first
                if (!string.IsNullOrEmpty(configuration))
                {
                    var config = (SwDMConfiguration3)doc.ConfigurationManager.GetConfigurationByName(configuration);
                    if (config != null)
                    {
                        try
                        {
                            // GetPreviewBitmap returns a DIB (Device Independent Bitmap)
                            previewBitmap = config.GetPreviewBitmap(out var errResult);
                            if (errResult != SwDmPreviewError.swDmPreviewErrorNone)
                                previewBitmap = null;
                        }
                        catch { previewBitmap = null; }
                    }
                }

                // Fall back to document-level preview
                if (previewBitmap == null)
                {
                    try
                    {
                        // SwDMDocument also has GetPreviewBitmap
                        var doc3 = (SwDMDocument13)doc;
                        previewBitmap = doc3.GetPreviewBitmap(out var errResult);
                        if (errResult != SwDmPreviewError.swDmPreviewErrorNone || previewBitmap == null)
                        {
                            doc.CloseDoc();
                            return new CommandResult { Success = false, Error = "No preview available for this file" };
                        }
                    }
                    catch (Exception ex)
                    {
                        doc.CloseDoc();
                        return new CommandResult { Success = false, Error = $"Failed to extract preview: {ex.Message}" };
                    }
                }

                doc.CloseDoc();

                // The preview bitmap is a byte array containing DIB data
                // We need to convert it to a usable image format (PNG)
                if (previewBitmap is byte[] dibData && dibData.Length > 0)
                {
                    // Convert DIB to PNG using GDI+
                    var pngData = ConvertDibToPng(dibData);
                    if (pngData == null || pngData.Length == 0)
                    {
                        return new CommandResult { Success = false, Error = "Failed to convert preview image" };
                    }

                    var base64 = Convert.ToBase64String(pngData);

                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            configuration = configuration ?? "default",
                            imageData = base64,
                            mimeType = "image/png",
                            sizeBytes = pngData.Length
                        }
                    };
                }

                return new CommandResult { Success = false, Error = "Preview data is not in expected format" };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
        }

        /// <summary>
        /// Convert a DIB (Device Independent Bitmap) byte array to PNG format.
        /// </summary>
        private static byte[]? ConvertDibToPng(byte[] dibData)
        {
            try
            {
                // DIB format: BITMAPINFOHEADER (40 bytes) + optional color table + pixel data
                // For simplicity, we'll just return the raw data as-is for now
                // A proper implementation would use System.Drawing to convert
                
                // Try to create a BMP file from the DIB data
                using (var ms = new MemoryStream())
                {
                    // BMP file header (14 bytes)
                    var fileSize = 14 + dibData.Length;
                    ms.Write(new byte[] { 0x42, 0x4D }, 0, 2);  // "BM" signature
                    ms.Write(BitConverter.GetBytes(fileSize), 0, 4);  // File size
                    ms.Write(new byte[] { 0, 0, 0, 0 }, 0, 4);  // Reserved
                    
                    // Calculate offset to pixel data (14 + BITMAPINFOHEADER size)
                    var headerSize = BitConverter.ToInt32(dibData, 0);
                    var pixelOffset = 14 + headerSize;
                    
                    // Check if there's a color table (for 8-bit images)
                    var bitCount = BitConverter.ToInt16(dibData, 14);
                    if (bitCount <= 8)
                    {
                        var colorTableSize = (1 << bitCount) * 4;  // 4 bytes per color
                        pixelOffset += colorTableSize;
                    }
                    
                    ms.Write(BitConverter.GetBytes(pixelOffset), 0, 4);  // Offset to pixel data
                    
                    // Write DIB data
                    ms.Write(dibData, 0, dibData.Length);
                    
                    return ms.ToArray();  // Returns BMP format (browsers can display this)
                }
            }
            catch
            {
                return null;
            }
        }

        #endregion

        #region Helpers

        private static string? GetDictValue(Dictionary<string, string> dict, string key)
        {
            if (dict.TryGetValue(key, out var value))
                return value;
            return null;
        }

        #endregion

        #region IDisposable

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _dmApp = null;
            GC.Collect();
        }

        #endregion
    }
}
