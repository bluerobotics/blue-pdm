// @ts-nocheck - Supabase type inference issues with new columns
import { useState, useEffect } from 'react'
import { 
  Upload, 
  Loader2, 
  MapPin,
  Phone,
  Globe,
  Save,
  Image as ImageIcon,
  X
} from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'

interface CompanyProfile {
  logo_url: string | null
  logo_storage_path: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  phone: string | null
  website: string | null
  contact_email: string | null
}

export function CompanyProfileSettings() {
  const { organization, user, addToast } = usePDMStore()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  
  const [profile, setProfile] = useState<CompanyProfile>({
    logo_url: null,
    logo_storage_path: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: 'USA',
    phone: null,
    website: null,
    contact_email: null
  })

  // Load current profile
  useEffect(() => {
    if (!organization?.id) return

    const loadProfile = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('logo_url, logo_storage_path, address_line1, address_line2, city, state, postal_code, country, phone, website, contact_email')
          .eq('id', organization.id)
          .single()

        if (error) throw error
        
        setProfile({
          logo_url: data?.logo_url || null,
          logo_storage_path: data?.logo_storage_path || null,
          address_line1: data?.address_line1 || null,
          address_line2: data?.address_line2 || null,
          city: data?.city || null,
          state: data?.state || null,
          postal_code: data?.postal_code || null,
          country: data?.country || 'USA',
          phone: data?.phone || null,
          website: data?.website || null,
          contact_email: data?.contact_email || null
        })
      } catch (err) {
        console.error('Failed to load company profile:', err)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [organization?.id])

  // Handle logo upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !organization?.id) return

    // Validate file
    if (!file.type.startsWith('image/')) {
      addToast('error', 'Please select an image file')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      addToast('error', 'Image must be less than 2MB')
      return
    }

    setUploadingLogo(true)
    try {
      // Upload to storage
      const filePath = `${organization.id}/logo.${file.name.split('.').pop()}`
      const { error: uploadError } = await supabase.storage
        .from('org-assets')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('org-assets')
        .getPublicUrl(filePath)

      // Update organization
      const { error: updateError } = await supabase
        .from('organizations')
        .update({
          logo_url: urlData.publicUrl,
          logo_storage_path: filePath
        })
        .eq('id', organization.id)

      if (updateError) throw updateError

      setProfile(prev => ({
        ...prev,
        logo_url: urlData.publicUrl,
        logo_storage_path: filePath
      }))

      addToast('success', 'Logo uploaded successfully')
    } catch (err) {
      console.error('Failed to upload logo:', err)
      addToast('error', 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  // Remove logo
  const handleRemoveLogo = async () => {
    if (!organization?.id) return

    try {
      // Delete from storage if exists
      if (profile.logo_storage_path) {
        await supabase.storage
          .from('org-assets')
          .remove([profile.logo_storage_path])
      }

      // Update organization
      const { error } = await supabase
        .from('organizations')
        .update({
          logo_url: null,
          logo_storage_path: null
        })
        .eq('id', organization.id)

      if (error) throw error

      setProfile(prev => ({
        ...prev,
        logo_url: null,
        logo_storage_path: null
      }))

      addToast('success', 'Logo removed')
    } catch (err) {
      console.error('Failed to remove logo:', err)
      addToast('error', 'Failed to remove logo')
    }
  }

  // Save all settings
  const handleSave = async () => {
    if (!organization?.id) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          address_line1: profile.address_line1 || null,
          address_line2: profile.address_line2 || null,
          city: profile.city || null,
          state: profile.state || null,
          postal_code: profile.postal_code || null,
          country: profile.country || 'USA',
          phone: profile.phone || null,
          website: profile.website || null,
          contact_email: profile.contact_email || null
        })
        .eq('id', organization.id)

      if (error) throw error
      addToast('success', 'Company profile saved')
    } catch (err) {
      console.error('Failed to save company profile:', err)
      addToast('error', 'Failed to save company profile')
    } finally {
      setSaving(false)
    }
  }

  // Update a single field
  const updateField = (field: keyof CompanyProfile, value: string | null) => {
    setProfile(prev => ({ ...prev, [field]: value }))
  }

  if (!organization) {
    return (
      <div className="text-center py-12 text-pdm-fg-muted">
        No organization connected
      </div>
    )
  }

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12 text-pdm-fg-muted">
        Only administrators can manage company profile
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-pdm-accent" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Company Logo */}
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon size={20} className="text-pdm-accent" />
          <h3 className="text-base font-medium text-pdm-fg">Company Logo</h3>
        </div>

        <div className="flex items-start gap-4">
          {profile.logo_url ? (
            <div className="relative">
              <img 
                src={profile.logo_url} 
                alt="Company logo" 
                className="h-16 max-w-48 object-contain rounded border border-pdm-border bg-white p-2"
              />
              <button
                onClick={handleRemoveLogo}
                className="absolute -top-2 -right-2 p-1 bg-pdm-error rounded-full text-white hover:bg-pdm-error/80"
                title="Remove logo"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="h-16 w-32 bg-pdm-highlight rounded border border-dashed border-pdm-border flex items-center justify-center text-pdm-fg-muted">
              <ImageIcon size={24} />
            </div>
          )}

          <div className="flex-1">
            <label className="btn btn-ghost btn-sm flex items-center gap-2 cursor-pointer">
              {uploadingLogo ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {profile.logo_url ? 'Replace Logo' : 'Upload Logo'}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={uploadingLogo}
                className="hidden"
              />
            </label>
            <p className="text-xs text-pdm-fg-muted mt-1">
              PNG, JPG, or SVG. Max 2MB. Appears on RFQ documents.
            </p>
          </div>
        </div>
      </div>

      {/* Company Address */}
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <div className="flex items-center gap-2 mb-4">
          <MapPin size={20} className="text-pdm-accent" />
          <h3 className="text-base font-medium text-pdm-fg">Company Address</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-sm text-pdm-fg-muted block mb-1">Address Line 1</label>
            <input
              type="text"
              value={profile.address_line1 || ''}
              onChange={(e) => updateField('address_line1', e.target.value)}
              placeholder="123 Main Street"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div className="col-span-2">
            <label className="text-sm text-pdm-fg-muted block mb-1">Address Line 2</label>
            <input
              type="text"
              value={profile.address_line2 || ''}
              onChange={(e) => updateField('address_line2', e.target.value)}
              placeholder="Suite 100"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div>
            <label className="text-sm text-pdm-fg-muted block mb-1">City</label>
            <input
              type="text"
              value={profile.city || ''}
              onChange={(e) => updateField('city', e.target.value)}
              placeholder="San Francisco"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div>
            <label className="text-sm text-pdm-fg-muted block mb-1">State/Province</label>
            <input
              type="text"
              value={profile.state || ''}
              onChange={(e) => updateField('state', e.target.value)}
              placeholder="CA"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div>
            <label className="text-sm text-pdm-fg-muted block mb-1">Postal Code</label>
            <input
              type="text"
              value={profile.postal_code || ''}
              onChange={(e) => updateField('postal_code', e.target.value)}
              placeholder="94102"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div>
            <label className="text-sm text-pdm-fg-muted block mb-1">Country</label>
            <input
              type="text"
              value={profile.country || ''}
              onChange={(e) => updateField('country', e.target.value)}
              placeholder="USA"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <div className="flex items-center gap-2 mb-4">
          <Phone size={20} className="text-pdm-accent" />
          <h3 className="text-base font-medium text-pdm-fg">Contact Information</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-pdm-fg-muted block mb-1">Phone</label>
            <input
              type="text"
              value={profile.phone || ''}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div>
            <label className="text-sm text-pdm-fg-muted block mb-1">Email</label>
            <input
              type="email"
              value={profile.contact_email || ''}
              onChange={(e) => updateField('contact_email', e.target.value)}
              placeholder="purchasing@company.com"
              className="w-full px-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
            />
          </div>
          <div className="col-span-2">
            <label className="text-sm text-pdm-fg-muted block mb-1">Website</label>
            <div className="relative">
              <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pdm-fg-muted" />
              <input
                type="url"
                value={profile.website || ''}
                onChange={(e) => updateField('website', e.target.value)}
                placeholder="https://www.company.com"
                className="w-full pl-9 pr-3 py-2 bg-pdm-input border border-pdm-border rounded text-sm text-pdm-fg placeholder:text-pdm-fg-muted/50 focus:outline-none focus:border-pdm-accent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary flex items-center gap-2"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Profile
        </button>
      </div>
    </div>
  )
}

