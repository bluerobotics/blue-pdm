import { useState, useEffect } from 'react'
import { Globe, FileText, Check, ChevronRight, Shield } from 'lucide-react'
import { usePDMStore, Language } from '../stores/pdmStore'

// Only show languages that have actual translations in i18n.ts
const LANGUAGES: { code: Language; name: string; nativeName: string; flag: string }[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文', flag: '🇹🇼' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
]

// Translations for onboarding text (matching languages with full app translations)
const TRANSLATIONS: Record<string, {
  welcome: string
  selectLanguage: string
  permissions: string
  usageStatsTitle: string
  usageStatsDesc: string
  usageStatsHelp: string
  enableStats: string
  noStats: string
  continue: string
  getStarted: string
  step: string
  of: string
}> = {
  en: {
    welcome: 'Welcome to BluePLM',
    selectLanguage: 'Select your language',
    permissions: 'Usage Statistics',
    usageStatsTitle: 'Help improve BluePLM',
    usageStatsDesc: 'Send anonymous usage statistics to help us identify and fix issues faster.',
    usageStatsHelp: 'Includes error reports and performance data only. No file contents or personal data.',
    enableStats: 'Help improve BluePLM',
    noStats: 'No thanks',
    continue: 'Continue',
    getStarted: 'Get Started',
    step: 'Step',
    of: 'of',
  },
  'zh-CN': {
    welcome: '欢迎使用 BluePLM',
    selectLanguage: '选择您的语言',
    permissions: '使用统计',
    usageStatsTitle: '帮助改进 BluePLM',
    usageStatsDesc: '发送匿名使用统计数据,帮助我们更快地发现和修复问题。',
    usageStatsHelp: '仅包含错误报告和性能数据,不包含文件内容或个人数据。',
    enableStats: '帮助改进 BluePLM',
    noStats: '暂不需要',
    continue: '继续',
    getStarted: '开始使用',
    step: '步骤',
    of: '/',
  },
  'zh-TW': {
    welcome: '歡迎使用 BluePLM',
    selectLanguage: '選擇您的語言',
    permissions: '使用統計',
    usageStatsTitle: '幫助改進 BluePLM',
    usageStatsDesc: '發送匿名使用統計數據,幫助我們更快地發現和修復問題。',
    usageStatsHelp: '僅包含錯誤報告和性能數據,不包含文件內容或個人數據。',
    enableStats: '幫助改進 BluePLM',
    noStats: '暫不需要',
    continue: '繼續',
    getStarted: '開始使用',
    step: '步驟',
    of: '/',
  },
  de: {
    welcome: 'Willkommen bei BluePLM',
    selectLanguage: 'Wählen Sie Ihre Sprache',
    permissions: 'Nutzungsstatistiken',
    usageStatsTitle: 'Helfen Sie BluePLM zu verbessern',
    usageStatsDesc: 'Senden Sie anonyme Nutzungsstatistiken, um uns zu helfen, Probleme schneller zu erkennen und zu beheben.',
    usageStatsHelp: 'Enthält nur Fehlerberichte und Leistungsdaten. Keine Dateiinhalte oder persönlichen Daten.',
    enableStats: 'BluePLM verbessern helfen',
    noStats: 'Nein, danke',
    continue: 'Weiter',
    getStarted: 'Loslegen',
    step: 'Schritt',
    of: 'von',
  },
  fr: {
    welcome: 'Bienvenue sur BluePLM',
    selectLanguage: 'Sélectionnez votre langue',
    permissions: 'Statistiques d\'utilisation',
    usageStatsTitle: 'Aidez à améliorer BluePLM',
    usageStatsDesc: 'Envoyez des statistiques d\'utilisation anonymes pour nous aider à identifier et corriger les problèmes plus rapidement.',
    usageStatsHelp: 'Comprend uniquement les rapports d\'erreurs et les données de performance. Aucun contenu de fichier ni données personnelles.',
    enableStats: 'Aider à améliorer BluePLM',
    noStats: 'Non merci',
    continue: 'Continuer',
    getStarted: 'Commencer',
    step: 'Étape',
    of: 'sur',
  },
  es: {
    welcome: 'Bienvenido a BluePLM',
    selectLanguage: 'Selecciona tu idioma',
    permissions: 'Estadísticas de uso',
    usageStatsTitle: 'Ayuda a mejorar BluePLM',
    usageStatsDesc: 'Envía estadísticas de uso anónimas para ayudarnos a identificar y solucionar problemas más rápido.',
    usageStatsHelp: 'Incluye solo reportes de errores y datos de rendimiento. Sin contenido de archivos ni datos personales.',
    enableStats: 'Ayudar a mejorar BluePLM',
    noStats: 'No, gracias',
    continue: 'Continuar',
    getStarted: 'Comenzar',
    step: 'Paso',
    of: 'de',
  },
  pt: {
    welcome: 'Bem-vindo ao BluePLM',
    selectLanguage: 'Selecione o seu idioma',
    permissions: 'Estatísticas de uso',
    usageStatsTitle: 'Ajude a melhorar o BluePLM',
    usageStatsDesc: 'Envie estatísticas de uso anónimas para nos ajudar a identificar e corrigir problemas mais rapidamente.',
    usageStatsHelp: 'Inclui apenas relatórios de erros e dados de desempenho. Sem conteúdo de ficheiros ou dados pessoais.',
    enableStats: 'Ajudar a melhorar o BluePLM',
    noStats: 'Não, obrigado',
    continue: 'Continuar',
    getStarted: 'Começar',
    step: 'Passo',
    of: 'de',
  },
}

// Get translations for a language, fallback to English
function getTranslations(lang: Language) {
  return TRANSLATIONS[lang] || TRANSLATIONS['en']
}

type OnboardingStep = 'language' | 'permissions'

export function OnboardingScreen() {
  const { language, setLanguage, setLogSharingEnabled, completeOnboarding } = usePDMStore()
  const [step, setStep] = useState<OnboardingStep>('language')
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [logsEnabled, setLogsEnabled] = useState(true)
  
  // Platform/SolidWorks detection for auto-configuration
  const [solidworksEnabled, setSolidworksEnabled] = useState(true)
  
  useEffect(() => {
    // Auto-detect platform and SolidWorks availability
    const detectSolidWorksAvailability = async () => {
      try {
        const platform = await window.electronAPI?.getPlatform()
        
        // On Mac (darwin), always disable SolidWorks integration
        if (platform === 'darwin') {
          setSolidworksEnabled(false)
          return
        }
        
        // On Windows, check if SolidWorks is installed
        if (platform === 'win32') {
          const result = await window.electronAPI?.solidworks?.isInstalled()
          if (result?.success && result.data?.installed) {
            setSolidworksEnabled(true)
          } else {
            // SolidWorks not installed - disable integration
            setSolidworksEnabled(false)
          }
        } else {
          // Linux or other platforms - disable
          setSolidworksEnabled(false)
        }
      } catch {
        // If detection fails, default to disabled (safer)
        setSolidworksEnabled(false)
      }
    }
    
    detectSolidWorksAvailability()
  }, [])
  
  const t = getTranslations(selectedLanguage)
  
  const handleLanguageSelect = (lang: Language) => {
    setSelectedLanguage(lang)
    setLanguage(lang)
  }
  
  const handleContinue = async () => {
    if (step === 'language') {
      setStep('permissions')
    } else {
      setLogSharingEnabled(logsEnabled)
      // Notify main process of analytics preference
      await window.electronAPI?.setAnalyticsEnabled(logsEnabled)
      completeOnboarding({ solidworksIntegrationEnabled: solidworksEnabled })
    }
  }

  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden">
      {/* Minimal title bar area */}
      <div className="h-8 flex-shrink-0 bg-plm-bg-header border-b border-plm-border" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      
      <div className="flex-1 flex items-center justify-center overflow-auto p-8">
        <div className="max-w-lg w-full">
          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="flex justify-center items-center gap-3 mb-4">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" className="text-plm-accent">
                <path 
                  d="M12 2L2 7L12 12L22 7L12 2Z" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
                <path 
                  d="M2 17L12 22L22 17" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
                <path 
                  d="M2 12L12 17L22 12" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-plm-fg mb-2">{t.welcome}</h1>
            
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-2 text-sm text-plm-fg-muted">
              <span>{t.step} {step === 'language' ? '1' : '2'} {t.of} 2</span>
              <div className="flex gap-1.5">
                <div className={`w-8 h-1.5 rounded-full transition-colors ${step === 'language' ? 'bg-plm-accent' : 'bg-plm-accent/30'}`} />
                <div className={`w-8 h-1.5 rounded-full transition-colors ${step === 'permissions' ? 'bg-plm-accent' : 'bg-plm-accent/30'}`} />
              </div>
            </div>
          </div>

          {/* Step 1: Language Selection */}
          {step === 'language' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-plm-accent/20 flex items-center justify-center">
                  <Globe size={20} className="text-plm-accent" />
                </div>
                <div>
                  <h2 className="font-semibold text-plm-fg">{t.selectLanguage}</h2>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageSelect(lang.code)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all text-left ${
                      selectedLanguage === lang.code
                        ? 'border-plm-accent bg-plm-accent/10'
                        : 'border-plm-border hover:border-plm-border-light bg-plm-bg-light'
                    }`}
                  >
                    <span className="text-2xl">{lang.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-plm-fg truncate">{lang.nativeName}</div>
                      <div className="text-xs text-plm-fg-muted truncate">{lang.name}</div>
                    </div>
                    {selectedLanguage === lang.code && (
                      <Check size={18} className="text-plm-accent flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Permissions (Log Sharing) */}
          {step === 'permissions' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-plm-accent/20 flex items-center justify-center">
                  <Shield size={20} className="text-plm-accent" />
                </div>
                <div>
                  <h2 className="font-semibold text-plm-fg">{t.permissions}</h2>
                </div>
              </div>

              <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <FileText size={24} className="text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-plm-fg mb-2">{t.usageStatsTitle}</h3>
                    <p className="text-sm text-plm-fg-muted mb-3">{t.usageStatsDesc}</p>
                    <p className="text-xs text-plm-fg-dim">{t.usageStatsHelp}</p>
                  </div>
                </div>

                <div className="mt-6 space-y-2">
                  <button
                    onClick={() => setLogsEnabled(true)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                      logsEnabled
                        ? 'border-plm-accent bg-plm-accent/10'
                        : 'border-plm-border hover:border-plm-border-light'
                    }`}
                  >
                    <span className="font-medium text-plm-fg">{t.enableStats}</span>
                    {logsEnabled && <Check size={18} className="text-plm-accent" />}
                  </button>
                  
                  <button
                    onClick={() => setLogsEnabled(false)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 transition-all ${
                      !logsEnabled
                        ? 'border-plm-accent bg-plm-accent/10'
                        : 'border-plm-border hover:border-plm-border-light'
                    }`}
                  >
                    <span className="font-medium text-plm-fg">{t.noStats}</span>
                    {!logsEnabled && <Check size={18} className="text-plm-accent" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Continue Button */}
          <div className="mt-8">
            <button
              onClick={handleContinue}
              className="w-full py-4 bg-plm-accent hover:bg-plm-accent/90 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {step === 'permissions' ? t.getStarted : t.continue}
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 text-xs text-plm-fg-muted">
            Made with 💙 by Blue Robotics
          </div>
        </div>
      </div>
    </div>
  )
}

