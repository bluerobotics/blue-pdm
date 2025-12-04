// Supabase Database Types
// These match the schema we'll create in Supabase

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          email_domains: string[]
          vault_path: string
          git_remote_url: string | null
          revision_scheme: 'letter' | 'numeric'
          settings: {
            require_checkout: boolean
            auto_increment_part_numbers: boolean
            part_number_prefix: string
            part_number_digits: number
            allowed_extensions: string[]
            require_description: boolean
            require_approval_for_release: boolean
          }
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          email_domains: string[]
          vault_path: string
          git_remote_url?: string | null
          revision_scheme?: 'letter' | 'numeric'
          settings?: {
            require_checkout?: boolean
            auto_increment_part_numbers?: boolean
            part_number_prefix?: string
            part_number_digits?: number
            allowed_extensions?: string[]
            require_description?: boolean
            require_approval_for_release?: boolean
          }
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          email_domains?: string[]
          vault_path?: string
          git_remote_url?: string | null
          revision_scheme?: 'letter' | 'numeric'
          settings?: {
            require_checkout?: boolean
            auto_increment_part_numbers?: boolean
            part_number_prefix?: string
            part_number_digits?: number
            allowed_extensions?: string[]
            require_description?: boolean
            require_approval_for_release?: boolean
          }
          created_at?: string
        }
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          org_id: string | null
          role: 'admin' | 'engineer' | 'viewer'
          created_at: string
          last_sign_in: string | null
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          org_id?: string | null
          role?: 'admin' | 'engineer' | 'viewer'
          created_at?: string
          last_sign_in?: string | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          org_id?: string | null
          role?: 'admin' | 'engineer' | 'viewer'
          created_at?: string
          last_sign_in?: string | null
        }
      }
      files: {
        Row: {
          id: string
          org_id: string
          file_path: string
          file_name: string
          extension: string
          file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
          part_number: string | null
          description: string | null
          revision: string
          version: number
          state: 'wip' | 'in_review' | 'released' | 'obsolete'
          state_changed_at: string
          state_changed_by: string | null
          checked_out_by: string | null
          checked_out_at: string | null
          lock_message: string | null
          git_hash: string | null
          lfs_oid: string | null
          file_size: number
          created_at: string
          created_by: string
          updated_at: string
          updated_by: string | null
          custom_properties: Record<string, string | number | null>
        }
        Insert: {
          id?: string
          org_id: string
          file_path: string
          file_name: string
          extension: string
          file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
          part_number?: string | null
          description?: string | null
          revision?: string
          version?: number
          state?: 'wip' | 'in_review' | 'released' | 'obsolete'
          state_changed_at?: string
          state_changed_by?: string | null
          checked_out_by?: string | null
          checked_out_at?: string | null
          lock_message?: string | null
          git_hash?: string | null
          lfs_oid?: string | null
          file_size?: number
          created_at?: string
          created_by: string
          updated_at?: string
          updated_by?: string | null
          custom_properties?: Record<string, string | number | null>
        }
        Update: {
          id?: string
          org_id?: string
          file_path?: string
          file_name?: string
          extension?: string
          file_type?: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
          part_number?: string | null
          description?: string | null
          revision?: string
          version?: number
          state?: 'wip' | 'in_review' | 'released' | 'obsolete'
          state_changed_at?: string
          state_changed_by?: string | null
          checked_out_by?: string | null
          checked_out_at?: string | null
          lock_message?: string | null
          git_hash?: string | null
          lfs_oid?: string | null
          file_size?: number
          created_at?: string
          created_by?: string
          updated_at?: string
          updated_by?: string | null
          custom_properties?: Record<string, string | number | null>
        }
      }
      file_versions: {
        Row: {
          id: string
          file_id: string
          version: number
          revision: string
          git_hash: string
          lfs_oid: string | null
          file_size: number
          comment: string | null
          state: 'wip' | 'in_review' | 'released' | 'obsolete'
          created_at: string
          created_by: string
        }
        Insert: {
          id?: string
          file_id: string
          version: number
          revision: string
          git_hash: string
          lfs_oid?: string | null
          file_size: number
          comment?: string | null
          state: 'wip' | 'in_review' | 'released' | 'obsolete'
          created_at?: string
          created_by: string
        }
        Update: {
          id?: string
          file_id?: string
          version?: number
          revision?: string
          git_hash?: string
          lfs_oid?: string | null
          file_size?: number
          comment?: string | null
          state?: 'wip' | 'in_review' | 'released' | 'obsolete'
          created_at?: string
          created_by?: string
        }
      }
      file_references: {
        Row: {
          id: string
          org_id: string
          parent_file_id: string
          child_file_id: string
          reference_type: 'component' | 'drawing_view' | 'derived' | 'copy'
          quantity: number
          configuration: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          parent_file_id: string
          child_file_id: string
          reference_type: 'component' | 'drawing_view' | 'derived' | 'copy'
          quantity?: number
          configuration?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          parent_file_id?: string
          child_file_id?: string
          reference_type?: 'component' | 'drawing_view' | 'derived' | 'copy'
          quantity?: number
          configuration?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      activity: {
        Row: {
          id: string
          org_id: string
          file_id: string | null
          user_id: string
          user_email: string
          action: 'checkout' | 'checkin' | 'create' | 'delete' | 'state_change' | 'revision_change' | 'rename' | 'move'
          details: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          file_id?: string | null
          user_id: string
          user_email: string
          action: 'checkout' | 'checkin' | 'create' | 'delete' | 'state_change' | 'revision_change' | 'rename' | 'move'
          details?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string | null
          user_id?: string
          user_email?: string
          action?: 'checkout' | 'checkin' | 'create' | 'delete' | 'state_change' | 'revision_change' | 'rename' | 'move'
          details?: Record<string, unknown>
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      file_state: 'wip' | 'in_review' | 'released' | 'obsolete'
      file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
      reference_type: 'component' | 'drawing_view' | 'derived' | 'copy'
      user_role: 'admin' | 'engineer' | 'viewer'
      revision_scheme: 'letter' | 'numeric'
    }
  }
}

