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
  X,
  Plus,
  Pencil,
  Trash2,
  Star,
  Building2,
  Truck,
  Copy,
  AlertTriangle,
  Mail,
  Shield
} from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'

interface CompanyProfile {
  logo_url: string | null
  logo_storage_path: string | null
  phone: string | null
  website: string | null
  contact_email: string | null
}

interface OrgAddress {
  id: string
  org_id: string
  address_type: 'billing' | 'shipping'
  label: string
  is_default: boolean
  company_name: string | null
  contact_name: string | null
  address_line1: string
  address_line2: string | null
  city: string
  state: string | null
  postal_code: string | null
  country: string
  attention_to: string | null
  phone: string | null
}

const emptyAddress: Omit<OrgAddress, 'id' | 'org_id'> = {
  address_type: 'billing',
  label: '',
  is_default: false,
  company_name: null,
  contact_name: null,
  address_line1: '',
  address_line2: null,
  city: '',
  state: null,
  postal_code: null,
  country: 'USA',
  attention_to: null,
  phone: null
}

export function CompanyProfileSettings() {
  const { organization, user, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  
  const [profile, setProfile] = useState<CompanyProfile>({
    logo_url: null,
    logo_storage_path: null,
    phone: null,
    website: null,
    contact_email: null
  })

  // Addresses state
  const [billingAddresses, setBillingAddresses] = useState<OrgAddress[]>([])
  const [shippingAddresses, setShippingAddresses] = useState<OrgAddress[]>([])
  const [loadingAddresses, setLoadingAddresses] = useState(true)
  
  // Address modal state
  const [showAddressModal, setShowAddressModal] = useState(false)
  const [editingAddress, setEditingAddress] = useState<OrgAddress | null>(null)
  const [addressForm, setAddressForm] = useState<Omit<OrgAddress, 'id' | 'org_id'>>(emptyAddress)
  const [savingAddress, setSavingAddress] = useState(false)
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null)
  
  // Delete confirmation modal state
  const [deleteConfirmAddress, setDeleteConfirmAddress] = useState<OrgAddress | null>(null)
  
  // Email domain settings state
  const [emailDomains, setEmailDomains] = useState<string[]>([])
  const [enforceEmailDomain, setEnforceEmailDomain] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [savingDomains, setSavingDomains] = useState(false)

  // Load current profile
  useEffect(() => {
    if (!organization?.id) return

    const loadProfile = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('logo_url, logo_storage_path, phone, website, contact_email, email_domains, settings')
          .eq('id', organization.id)
          .single()

        if (error) throw error
        
        console.log('[CompanyProfile] Loaded from DB:', { 
          logo_url: data?.logo_url?.substring(0, 50) + '...', 
          logo_storage_path: data?.logo_storage_path 
        })
        
        // If we have a storage path, get a fresh signed URL
        let logoUrl = data?.logo_url || null
        if (data?.logo_storage_path) {
          const { data: signedData, error: signedError } = await supabase.storage
            .from('vault')
            .createSignedUrl(data.logo_storage_path, 60 * 60 * 24 * 365) // 1 year
          
          if (signedError) {
            console.error('[CompanyProfile] Failed to create signed URL:', signedError)
          } else if (signedData?.signedUrl) {
            console.log('[CompanyProfile] Generated fresh signed URL')
            logoUrl = signedData.signedUrl
          }
        }
        
        setProfile({
          logo_url: logoUrl,
          logo_storage_path: data?.logo_storage_path || null,
          phone: data?.phone || null,
          website: data?.website || null,
          contact_email: data?.contact_email || null
        })
        
        // Load email domain settings
        setEmailDomains(data?.email_domains || [])
        const settings = data?.settings || {}
        setEnforceEmailDomain(settings.enforce_email_domain ?? false)
      } catch (err) {
        console.error('Failed to load company profile:', err)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [organization?.id])

  // Load addresses
  useEffect(() => {
    if (!organization?.id) return

    const loadAddresses = async () => {
      setLoadingAddresses(true)
      try {
        const { data, error } = await supabase
          .from('organization_addresses')
          .select('*')
          .eq('org_id', organization.id)
          .order('is_default', { ascending: false })
          .order('label')

        if (error) throw error
        
        const addresses = (data || []) as OrgAddress[]
        setBillingAddresses(addresses.filter(a => a.address_type === 'billing'))
        setShippingAddresses(addresses.filter(a => a.address_type === 'shipping'))
      } catch (err) {
        console.error('Failed to load addresses:', err)
      } finally {
        setLoadingAddresses(false)
      }
    }

    loadAddresses()
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
      // Upload to vault bucket under _assets folder
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const filePath = `${organization.id}/_assets/logo.${ext}`
      
      console.log('[CompanyProfile] Uploading logo to:', filePath)
      
      const { error: uploadError } = await supabase.storage
        .from('vault')
        .upload(filePath, file, { upsert: true })

      if (uploadError) throw uploadError

      // Get a signed URL (valid for 1 year - will refresh when loading profile)
      const { data: signedData, error: signedError } = await supabase.storage
        .from('vault')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365) // 1 year

      if (signedError) throw signedError

      // Update organization with signed URL and storage path using RPC function
      // (Direct updates aren't allowed due to RLS policy)
      console.log('[CompanyProfile] Saving to DB via RPC - logo_storage_path:', filePath)
      const { error: updateError } = await supabase.rpc('update_org_branding', {
        p_org_id: organization.id,
        p_logo_url: signedData.signedUrl,
        p_logo_storage_path: filePath
      })

      if (updateError) {
        console.error('[CompanyProfile] DB update error:', updateError)
        throw updateError
      }
      
      console.log('[CompanyProfile] Logo saved successfully')

      setProfile(prev => ({
        ...prev,
        logo_url: signedData.signedUrl,
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
          .from('vault')
          .remove([profile.logo_storage_path])
      }

      // Update organization using RPC function (direct updates not allowed due to RLS)
      // Pass empty strings to clear the values (COALESCE in function will handle nulls)
      const { error } = await supabase.rpc('update_org_branding', {
        p_org_id: organization.id,
        p_logo_url: '',
        p_logo_storage_path: ''
      })

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

  // Save contact info
  const handleSave = async () => {
    if (!organization?.id) return

    setSaving(true)
    try {
      // Use RPC function (direct updates not allowed due to RLS)
      const { error } = await supabase.rpc('update_org_branding', {
        p_org_id: organization.id,
        p_phone: profile.phone || null,
        p_website: profile.website || null,
        p_contact_email: profile.contact_email || null
      })

      if (error) throw error
      addToast('success', 'Contact information saved')
    } catch (err) {
      console.error('Failed to save contact info:', err)
      addToast('error', 'Failed to save contact information')
    } finally {
      setSaving(false)
    }
  }

  // Update a single field
  const updateField = (field: keyof CompanyProfile, value: string | null) => {
    setProfile(prev => ({ ...prev, [field]: value }))
  }

  // Open address modal for new address
  const openNewAddressModal = (type: 'billing' | 'shipping') => {
    setEditingAddress(null)
    setAddressForm({
      ...emptyAddress,
      address_type: type,
      is_default: type === 'billing' ? billingAddresses.length === 0 : shippingAddresses.length === 0
    })
    setShowAddressModal(true)
  }

  // Open address modal for editing
  const openEditAddressModal = (address: OrgAddress) => {
    setEditingAddress(address)
    setAddressForm({
      address_type: address.address_type,
      label: address.label,
      is_default: address.is_default,
      company_name: address.company_name,
      contact_name: address.contact_name,
      address_line1: address.address_line1,
      address_line2: address.address_line2,
      city: address.city,
      state: address.state,
      postal_code: address.postal_code,
      country: address.country,
      attention_to: address.attention_to,
      phone: address.phone
    })
    setShowAddressModal(true)
  }

  // Save address
  const handleSaveAddress = async () => {
    if (!organization?.id) return
    if (!addressForm.label.trim() || !addressForm.address_line1.trim() || !addressForm.city.trim()) {
      addToast('error', 'Please fill in required fields (Label, Address Line 1, City)')
      return
    }

    setSavingAddress(true)
    try {
      if (editingAddress) {
        // Update existing
        const { error } = await supabase
          .from('organization_addresses')
          .update({
            label: addressForm.label.trim(),
            is_default: addressForm.is_default,
            company_name: addressForm.company_name?.trim() || null,
            contact_name: addressForm.contact_name?.trim() || null,
            address_line1: addressForm.address_line1.trim(),
            address_line2: addressForm.address_line2?.trim() || null,
            city: addressForm.city.trim(),
            state: addressForm.state?.trim() || null,
            postal_code: addressForm.postal_code?.trim() || null,
            country: addressForm.country || 'USA',
            attention_to: addressForm.attention_to?.trim() || null,
            phone: addressForm.phone?.trim() || null
          })
          .eq('id', editingAddress.id)

        if (error) throw error

        // Update local state
        const updatedAddress = { ...editingAddress, ...addressForm }
        if (addressForm.address_type === 'billing') {
          setBillingAddresses(prev => prev.map(a => 
            a.id === editingAddress.id 
              ? updatedAddress 
              : addressForm.is_default ? { ...a, is_default: false } : a
          ))
        } else {
          setShippingAddresses(prev => prev.map(a => 
            a.id === editingAddress.id 
              ? updatedAddress 
              : addressForm.is_default ? { ...a, is_default: false } : a
          ))
        }

        addToast('success', 'Address updated')
      } else {
        // Create new
        const { data, error } = await supabase
          .from('organization_addresses')
          .insert({
            org_id: organization.id,
            address_type: addressForm.address_type,
            label: addressForm.label.trim(),
            is_default: addressForm.is_default,
            company_name: addressForm.company_name?.trim() || null,
            contact_name: addressForm.contact_name?.trim() || null,
            address_line1: addressForm.address_line1.trim(),
            address_line2: addressForm.address_line2?.trim() || null,
            city: addressForm.city.trim(),
            state: addressForm.state?.trim() || null,
            postal_code: addressForm.postal_code?.trim() || null,
            country: addressForm.country || 'USA',
            attention_to: addressForm.attention_to?.trim() || null,
            phone: addressForm.phone?.trim() || null
          })
          .select()
          .single()

        if (error) throw error

        // Update local state
        const newAddress = data as OrgAddress
        if (addressForm.address_type === 'billing') {
          setBillingAddresses(prev => addressForm.is_default 
            ? [newAddress, ...prev.map(a => ({ ...a, is_default: false }))]
            : [...prev, newAddress]
          )
        } else {
          setShippingAddresses(prev => addressForm.is_default 
            ? [newAddress, ...prev.map(a => ({ ...a, is_default: false }))]
            : [...prev, newAddress]
          )
        }

        addToast('success', 'Address added')
      }

      setShowAddressModal(false)
      setEditingAddress(null)
    } catch (err) {
      console.error('Failed to save address:', err)
      addToast('error', 'Failed to save address')
    } finally {
      setSavingAddress(false)
    }
  }

  // Delete address - show confirmation modal
  const handleDeleteAddress = (address: OrgAddress) => {
    setDeleteConfirmAddress(address)
  }

  // Confirm and execute address deletion
  const confirmDeleteAddress = async () => {
    if (!deleteConfirmAddress) return

    setDeletingAddressId(deleteConfirmAddress.id)
    try {
      const { error } = await supabase
        .from('organization_addresses')
        .delete()
        .eq('id', deleteConfirmAddress.id)

      if (error) throw error

      if (deleteConfirmAddress.address_type === 'billing') {
        setBillingAddresses(prev => prev.filter(a => a.id !== deleteConfirmAddress.id))
      } else {
        setShippingAddresses(prev => prev.filter(a => a.id !== deleteConfirmAddress.id))
      }

      addToast('success', 'Address deleted')
    } catch (err) {
      console.error('Failed to delete address:', err)
      addToast('error', 'Failed to delete address')
    } finally {
      setDeletingAddressId(null)
      setDeleteConfirmAddress(null)
    }
  }

  // Copy from another address
  const handleCopyFromAddress = (sourceAddress: OrgAddress) => {
    setAddressForm(prev => ({
      ...prev,
      // Company name is used for both billing and shipping
      company_name: sourceAddress.company_name,
      // Only copy contact_name for billing addresses
      contact_name: prev.address_type === 'billing' ? sourceAddress.contact_name : null,
      address_line1: sourceAddress.address_line1,
      address_line2: sourceAddress.address_line2,
      city: sourceAddress.city,
      state: sourceAddress.state,
      postal_code: sourceAddress.postal_code,
      country: sourceAddress.country,
      phone: sourceAddress.phone,
      // Only copy attention_to for shipping addresses
      attention_to: prev.address_type === 'shipping' ? sourceAddress.attention_to : null
    }))
    addToast('success', `Copied from "${sourceAddress.label}"`)
  }

  // Get addresses of the opposite type for copying
  const getSourceAddressesForCopy = () => {
    return addressForm.address_type === 'billing' ? shippingAddresses : billingAddresses
  }

  // Set address as default
  const handleSetDefault = async (address: OrgAddress) => {
    try {
      const { error } = await supabase
        .from('organization_addresses')
        .update({ is_default: true })
        .eq('id', address.id)

      if (error) throw error

      // Update local state - the trigger handles unsetting others
      if (address.address_type === 'billing') {
        setBillingAddresses(prev => prev.map(a => ({
          ...a,
          is_default: a.id === address.id
        })))
      } else {
        setShippingAddresses(prev => prev.map(a => ({
          ...a,
          is_default: a.id === address.id
        })))
      }

      addToast('success', `"${address.label}" set as default`)
    } catch (err) {
      console.error('Failed to set default:', err)
      addToast('error', 'Failed to set default address')
    }
  }

  // Add email domain
  const handleAddDomain = async () => {
    const domain = newDomain.trim().toLowerCase()
    if (!domain || !organization?.id) return
    
    // Validate domain format
    if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i.test(domain)) {
      addToast('error', 'Invalid domain format')
      return
    }
    
    // Check if already exists
    if (emailDomains.includes(domain)) {
      addToast('error', 'Domain already added')
      return
    }
    
    setSavingDomains(true)
    const newDomains = [...emailDomains, domain]
    
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ email_domains: newDomains })
        .eq('id', organization.id)
      
      if (error) throw error
      
      setEmailDomains(newDomains)
      setNewDomain('')
      addToast('success', `Added @${domain}`)
    } catch (err) {
      console.error('Failed to add domain:', err)
      addToast('error', 'Failed to add domain')
    } finally {
      setSavingDomains(false)
    }
  }

  // Render address card
  const renderAddressCard = (address: OrgAddress) => (
    <div 
      key={address.id}
      className={`p-3 rounded-lg border ${address.is_default ? 'border-plm-accent bg-plm-accent/5' : 'border-plm-border bg-plm-highlight/50'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-plm-fg truncate">{address.label}</span>
            {address.is_default && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-plm-accent/20 text-plm-accent rounded">
                <Star size={10} />
                Default
              </span>
            )}
          </div>
          <div className="text-xs text-plm-fg-muted mt-1 space-y-0.5">
            {address.company_name && <div className="font-medium text-plm-fg">{address.company_name}</div>}
            {address.contact_name && <div>{address.contact_name}</div>}
            {address.attention_to && <div>ATTN: {address.attention_to}</div>}
            <div>{address.address_line1}</div>
            {address.address_line2 && <div>{address.address_line2}</div>}
            <div>
              {address.city}
              {address.state && `, ${address.state}`}
              {address.postal_code && ` ${address.postal_code}`}
            </div>
            {address.country !== 'USA' && <div>{address.country}</div>}
            {address.phone && <div>{address.phone}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!address.is_default && (
            <button
              onClick={() => handleSetDefault(address)}
              className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-highlight rounded transition-colors"
              title="Set as default"
            >
              <Star size={14} />
            </button>
          )}
          <button
            onClick={() => openEditAddressModal(address)}
            className="p-1.5 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => handleDeleteAddress(address)}
            disabled={deletingAddressId === address.id}
            className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-highlight rounded transition-colors disabled:opacity-50"
            title="Delete"
          >
            {deletingAddressId === address.id ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  )

  if (!organization) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        No organization connected
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        Only administrators can manage company profile
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-plm-accent" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Company Logo */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon size={20} className="text-plm-accent" />
          <h3 className="text-base font-medium text-plm-fg">Company Logo</h3>
        </div>

        <div className="flex items-start gap-4">
          {profile.logo_url ? (
            <div className="relative">
              <img 
                src={profile.logo_url} 
                alt="Company logo" 
                className="h-16 max-w-48 object-contain rounded border border-plm-border p-2"
              />
              <button
                onClick={handleRemoveLogo}
                className="absolute -top-2 -right-2 p-1 bg-plm-error rounded-full text-white hover:bg-plm-error/80"
                title="Remove logo"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="h-16 w-32 bg-plm-highlight rounded border border-dashed border-plm-border flex items-center justify-center text-plm-fg-muted">
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
            <p className="text-xs text-plm-fg-muted mt-1">
              PNG, JPG, or SVG. Max 2MB. Appears on RFQ documents.
            </p>
          </div>
        </div>
      </div>

      {/* Billing Addresses */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Building2 size={20} className="text-plm-accent" />
            <h3 className="text-base font-medium text-plm-fg">Billing Addresses</h3>
          </div>
          <button
            onClick={() => openNewAddressModal('billing')}
            className="btn btn-ghost btn-sm flex items-center gap-1"
          >
            <Plus size={14} />
            Add Address
          </button>
        </div>

        {loadingAddresses ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-plm-accent" size={20} />
          </div>
        ) : billingAddresses.length === 0 ? (
          <div className="text-center py-6 text-plm-fg-muted text-sm">
            No billing addresses yet.
          </div>
        ) : (
          <div className="space-y-2">
            {billingAddresses.map(renderAddressCard)}
          </div>
        )}
      </div>

      {/* Shipping Addresses */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Truck size={20} className="text-plm-accent" />
            <h3 className="text-base font-medium text-plm-fg">Shipping Addresses</h3>
          </div>
          <button
            onClick={() => openNewAddressModal('shipping')}
            className="btn btn-ghost btn-sm flex items-center gap-1"
          >
            <Plus size={14} />
            Add Address
          </button>
        </div>

        {loadingAddresses ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-plm-accent" size={20} />
          </div>
        ) : shippingAddresses.length === 0 ? (
          <div className="text-center py-6 text-plm-fg-muted text-sm">
            No shipping addresses yet.
          </div>
        ) : (
          <div className="space-y-2">
            {shippingAddresses.map(renderAddressCard)}
          </div>
        )}
      </div>

      {/* Contact Information */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center gap-2 mb-4">
          <Phone size={20} className="text-plm-accent" />
          <h3 className="text-base font-medium text-plm-fg">Contact Information</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Phone</label>
            <input
              type="text"
              value={profile.phone || ''}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
            />
          </div>
          <div>
            <label className="text-sm text-plm-fg-muted block mb-1">Email</label>
            <input
              type="email"
              value={profile.contact_email || ''}
              onChange={(e) => updateField('contact_email', e.target.value)}
              placeholder="purchasing@company.com"
              className="w-full px-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
            />
          </div>
          <div className="col-span-2">
            <label className="text-sm text-plm-fg-muted block mb-1">Website</label>
            <div className="relative">
              <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
              <input
                type="url"
                value={profile.website || ''}
                onChange={(e) => updateField('website', e.target.value)}
                placeholder="https://www.company.com"
                className="w-full pl-9 pr-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-4">
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
            Save Contact Info
          </button>
        </div>
      </div>

      {/* Email Domain Settings */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={20} className="text-plm-accent" />
          <h3 className="text-base font-medium text-plm-fg">Email Domain Settings</h3>
        </div>
        
        <p className="text-sm text-plm-fg-muted mb-4">
          Configure which email domains can join your organization. When enforcement is off, anyone with the organization code can join regardless of their email domain.
        </p>

        {/* Enforce toggle */}
        <div className="flex items-center justify-between p-3 bg-plm-highlight/50 rounded-lg border border-plm-border mb-4">
          <div className="flex items-center gap-3">
            <Shield size={18} className={enforceEmailDomain ? 'text-plm-accent' : 'text-plm-fg-muted'} />
            <div>
              <div className="text-sm font-medium text-plm-fg">Enforce Email Domain</div>
              <div className="text-xs text-plm-fg-muted">
                {enforceEmailDomain 
                  ? 'Only users with matching email domains can join' 
                  : 'Anyone with the organization code can join'}
              </div>
            </div>
          </div>
          <button
            onClick={async () => {
              const newValue = !enforceEmailDomain
              setEnforceEmailDomain(newValue)
              
              try {
                // Fetch current settings from database first to avoid overwriting other fields
                const { data: currentOrg } = await supabase
                  .from('organizations')
                  .select('settings')
                  .eq('id', organization?.id)
                  .single()
                
                const currentSettings = (currentOrg as any)?.settings || organization?.settings || {}
                const newSettings = { ...currentSettings, enforce_email_domain: newValue }
                
                const { error } = await supabase
                  .from('organizations')
                  .update({ settings: newSettings })
                  .eq('id', organization?.id)
                
                if (error) throw error
                addToast('success', newValue ? 'Email domain enforcement enabled' : 'Email domain enforcement disabled')
              } catch (err) {
                console.error('Failed to update setting:', err)
                setEnforceEmailDomain(!newValue) // Revert
                addToast('error', 'Failed to update setting')
              }
            }}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              enforceEmailDomain ? 'bg-plm-accent' : 'bg-plm-fg-muted/30'
            }`}
          >
            <span 
              className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                enforceEmailDomain ? 'translate-x-5' : 'translate-x-0'
              }`} 
            />
          </button>
        </div>

        {/* Domain list */}
        <div className="space-y-2 mb-4">
          <label className="text-sm text-plm-fg-muted">Allowed Email Domains</label>
          {emailDomains.length === 0 ? (
            <div className="text-sm text-plm-fg-dim py-2">
              No domains configured. Add a domain below.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {emailDomains.map((domain, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-plm-bg-secondary border border-plm-border rounded-lg text-sm"
                >
                  <Mail size={14} className="text-plm-fg-muted" />
                  <span className="text-plm-fg">@{domain}</span>
                  <button
                    onClick={async () => {
                      const newDomains = emailDomains.filter((_, i) => i !== idx)
                      setEmailDomains(newDomains)
                      
                      try {
                        const { error } = await supabase
                          .from('organizations')
                          .update({ email_domains: newDomains })
                          .eq('id', organization?.id)
                        
                        if (error) throw error
                        addToast('success', `Removed @${domain}`)
                      } catch (err) {
                        console.error('Failed to remove domain:', err)
                        setEmailDomains(emailDomains) // Revert
                        addToast('error', 'Failed to remove domain')
                      }
                    }}
                    className="p-0.5 hover:bg-plm-error/20 rounded text-plm-fg-muted hover:text-plm-error transition-colors"
                    title="Remove domain"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add domain */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted text-sm">@</span>
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value.toLowerCase().replace(/^@/, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDomain.trim()) {
                  e.preventDefault()
                  handleAddDomain()
                }
              }}
              placeholder="example.com"
              className="w-full pl-7 pr-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
            />
          </div>
          <button
            onClick={handleAddDomain}
            disabled={!newDomain.trim() || savingDomains}
            className="btn btn-primary flex items-center gap-2"
          >
            {savingDomains ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Add Domain
          </button>
        </div>
      </div>

      {/* Address Modal */}
      {showAddressModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-plm-bg-elevated rounded-lg border border-plm-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-plm-border">
              <h3 className="text-lg font-medium text-plm-fg">
                {editingAddress ? 'Edit Address' : `New ${addressForm.address_type === 'billing' ? 'Billing' : 'Shipping'} Address`}
              </h3>
              <button
                onClick={() => setShowAddressModal(false)}
                className="p-1 text-plm-fg-muted hover:text-plm-fg rounded"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Copy from existing address */}
              {getSourceAddressesForCopy().length > 0 && (
                <div className="p-3 bg-plm-highlight/50 rounded-lg border border-plm-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Copy size={14} className="text-plm-accent" />
                    <span className="text-sm text-plm-fg">
                      Copy from {addressForm.address_type === 'billing' ? 'shipping' : 'billing'} address
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getSourceAddressesForCopy().map(addr => (
                      <button
                        key={addr.id}
                        onClick={() => handleCopyFromAddress(addr)}
                        className="px-2.5 py-1.5 text-xs bg-plm-bg border border-plm-border rounded hover:border-plm-accent hover:text-plm-accent transition-colors flex items-center gap-1.5"
                      >
                        {addr.is_default && <Star size={10} className="text-plm-accent" />}
                        {addr.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm text-plm-fg-muted block mb-1">Label *</label>
                <input
                  type="text"
                  value={addressForm.label}
                  onChange={(e) => setAddressForm(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="e.g., Main Office, Warehouse, HQ"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>

              {/* Company Name - shown for both billing and shipping */}
              <div>
                <label className="text-sm text-plm-fg-muted block mb-1">Company Name</label>
                <input
                  type="text"
                  value={addressForm.company_name || ''}
                  onChange={(e) => setAddressForm(prev => ({ ...prev, company_name: e.target.value }))}
                  placeholder="Acme Corporation"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>

              {/* Contact Name - only shown for billing addresses */}
              {addressForm.address_type === 'billing' && (
                <div>
                  <label className="text-sm text-plm-fg-muted block mb-1">Contact Name</label>
                  <input
                    type="text"
                    value={addressForm.contact_name || ''}
                    onChange={(e) => setAddressForm(prev => ({ ...prev, contact_name: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  />
                </div>
              )}

              {/* Attention To - only shown for shipping addresses */}
              {addressForm.address_type === 'shipping' && (
                <div>
                  <label className="text-sm text-plm-fg-muted block mb-1">Attention To</label>
                  <input
                    type="text"
                    value={addressForm.attention_to || ''}
                    onChange={(e) => setAddressForm(prev => ({ ...prev, attention_to: e.target.value }))}
                    placeholder="e.g., Receiving Dept, John Smith"
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  />
                </div>
              )}

              <div>
                <label className="text-sm text-plm-fg-muted block mb-1">Address Line 1 *</label>
                <input
                  type="text"
                  value={addressForm.address_line1}
                  onChange={(e) => setAddressForm(prev => ({ ...prev, address_line1: e.target.value }))}
                  placeholder="123 Main Street"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>

              <div>
                <label className="text-sm text-plm-fg-muted block mb-1">Address Line 2</label>
                <input
                  type="text"
                  value={addressForm.address_line2 || ''}
                  onChange={(e) => setAddressForm(prev => ({ ...prev, address_line2: e.target.value }))}
                  placeholder="Suite 100"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-plm-fg-muted block mb-1">City *</label>
                  <input
                    type="text"
                    value={addressForm.city}
                    onChange={(e) => setAddressForm(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="San Francisco"
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  />
                </div>
                <div>
                  <label className="text-sm text-plm-fg-muted block mb-1">State/Province</label>
                  <input
                    type="text"
                    value={addressForm.state || ''}
                    onChange={(e) => setAddressForm(prev => ({ ...prev, state: e.target.value }))}
                    placeholder="CA"
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-plm-fg-muted block mb-1">Postal Code</label>
                  <input
                    type="text"
                    value={addressForm.postal_code || ''}
                    onChange={(e) => setAddressForm(prev => ({ ...prev, postal_code: e.target.value }))}
                    placeholder="94102"
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  />
                </div>
                <div>
                  <label className="text-sm text-plm-fg-muted block mb-1">Country</label>
                  <input
                    type="text"
                    value={addressForm.country}
                    onChange={(e) => setAddressForm(prev => ({ ...prev, country: e.target.value }))}
                    placeholder="USA"
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-plm-fg-muted block mb-1">Phone</label>
                <input
                  type="text"
                  value={addressForm.phone || ''}
                  onChange={(e) => setAddressForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1 (555) 123-4567"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addressForm.is_default}
                  onChange={(e) => setAddressForm(prev => ({ ...prev, is_default: e.target.checked }))}
                  className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                />
                <span className="text-sm text-plm-fg">Set as default {addressForm.address_type} address</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-plm-border">
              <button
                onClick={() => setShowAddressModal(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAddress}
                disabled={savingAddress}
                className="btn btn-primary flex items-center gap-2"
              >
                {savingAddress ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {editingAddress ? 'Update Address' : 'Add Address'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Address Confirmation Modal */}
      {deleteConfirmAddress && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setDeleteConfirmAddress(null)}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-full bg-plm-error/20">
                <AlertTriangle className="w-5 h-5 text-plm-error" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-plm-fg">Delete Address?</h3>
                <p className="text-sm text-plm-fg-muted mt-1">
                  "{deleteConfirmAddress.label}" ({deleteConfirmAddress.address_type})
                </p>
              </div>
            </div>
            
            <p className="text-sm text-plm-fg-muted mb-4">
              This will permanently delete this address. This action cannot be undone.
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmAddress(null)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAddress}
                disabled={deletingAddressId === deleteConfirmAddress.id}
                className="btn bg-plm-error hover:bg-plm-error/80 text-white flex items-center gap-2"
              >
                {deletingAddressId === deleteConfirmAddress.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
