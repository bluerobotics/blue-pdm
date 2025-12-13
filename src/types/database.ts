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
          revision_scheme: 'letter' | 'numeric'
          settings: {
            require_checkout: boolean
            auto_increment_part_numbers: boolean
            part_number_prefix: string
            part_number_digits: number
            allowed_extensions: string[]
            require_description: boolean
            require_approval_for_release: boolean
            max_file_size_mb: number
          }
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          email_domains: string[]
          revision_scheme?: 'letter' | 'numeric'
          settings?: {
            require_checkout?: boolean
            auto_increment_part_numbers?: boolean
            part_number_prefix?: string
            part_number_digits?: number
            allowed_extensions?: string[]
            require_description?: boolean
            require_approval_for_release?: boolean
            max_file_size_mb?: number
          }
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          email_domains?: string[]
          revision_scheme?: 'letter' | 'numeric'
          settings?: {
            require_checkout?: boolean
            auto_increment_part_numbers?: boolean
            part_number_prefix?: string
            part_number_digits?: number
            allowed_extensions?: string[]
            require_description?: boolean
            require_approval_for_release?: boolean
            max_file_size_mb?: number
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
          vault_id?: string
          file_path: string
          file_name: string
          extension: string
          file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
          part_number: string | null
          description: string | null
          revision: string
          version: number
          state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          state_changed_at: string
          state_changed_by: string | null
          checked_out_by: string | null
          checked_out_at: string | null
          lock_message: string | null
          checked_out_by_machine_id: string | null
          checked_out_by_machine_name: string | null
          content_hash: string | null
          file_size: number
          created_at: string
          created_by: string
          updated_at: string
          updated_by: string | null
          custom_properties: Record<string, string | number | null>
          deleted_at: string | null
          deleted_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          vault_id?: string
          file_path: string
          file_name: string
          extension: string
          file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
          part_number?: string | null
          description?: string | null
          revision?: string
          version?: number
          state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          state_changed_at?: string
          state_changed_by?: string | null
          checked_out_by?: string | null
          checked_out_at?: string | null
          lock_message?: string | null
          checked_out_by_machine_id?: string | null
          checked_out_by_machine_name?: string | null
          content_hash?: string | null
          file_size?: number
          created_at?: string
          created_by: string
          updated_at?: string
          updated_by?: string | null
          custom_properties?: Record<string, string | number | null>
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          vault_id?: string
          file_path?: string
          file_name?: string
          extension?: string
          file_type?: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
          part_number?: string | null
          description?: string | null
          revision?: string
          version?: number
          state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          state_changed_at?: string
          state_changed_by?: string | null
          checked_out_by?: string | null
          checked_out_at?: string | null
          lock_message?: string | null
          checked_out_by_machine_id?: string | null
          checked_out_by_machine_name?: string | null
          content_hash?: string | null
          file_size?: number
          created_at?: string
          created_by?: string
          updated_at?: string
          updated_by?: string | null
          custom_properties?: Record<string, string | number | null>
          deleted_at?: string | null
          deleted_by?: string | null
        }
      }
      file_versions: {
        Row: {
          id: string
          file_id: string
          version: number
          revision: string
          content_hash: string
          file_size: number
          comment: string | null
          state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          created_at: string
          created_by: string
        }
        Insert: {
          id?: string
          file_id: string
          version: number
          revision: string
          content_hash: string
          file_size?: number
          comment?: string | null
          state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          created_at?: string
          created_by: string
        }
        Update: {
          id?: string
          file_id?: string
          version?: number
          revision?: string
          content_hash?: string
          file_size?: number
          comment?: string | null
          state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
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
          action: 'checkout' | 'checkin' | 'create' | 'delete' | 'restore' | 'state_change' | 'revision_change' | 'rename' | 'move' | 'rollback' | 'roll_forward'
          details: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          file_id?: string | null
          user_id: string
          user_email: string
          action: 'checkout' | 'checkin' | 'create' | 'delete' | 'restore' | 'state_change' | 'revision_change' | 'rename' | 'move' | 'rollback' | 'roll_forward'
          details?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string | null
          user_id?: string
          user_email?: string
          action?: 'checkout' | 'checkin' | 'create' | 'delete' | 'restore' | 'state_change' | 'revision_change' | 'rename' | 'move' | 'rollback' | 'roll_forward'
          details?: Record<string, unknown>
          created_at?: string
        }
      }
      vaults: {
        Row: {
          id: string
          org_id: string
          name: string
          slug: string
          description: string | null
          storage_bucket: string
          is_default: boolean
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          slug: string
          description?: string | null
          storage_bucket: string
          is_default?: boolean
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          slug?: string
          description?: string | null
          storage_bucket?: string
          is_default?: boolean
          created_by?: string
          created_at?: string
        }
      }
      vault_access: {
        Row: {
          id: string
          vault_id: string
          user_id: string
          granted_by: string | null
          granted_at: string
        }
        Insert: {
          id?: string
          vault_id: string
          user_id: string
          granted_by?: string | null
          granted_at?: string
        }
        Update: {
          id?: string
          vault_id?: string
          user_id?: string
          granted_by?: string | null
          granted_at?: string
        }
      }
      ecos: {
        Row: {
          id: string
          org_id: string
          eco_number: string
          title: string | null
          description: string | null
          status: 'open' | 'in_progress' | 'completed' | 'cancelled'
          created_at: string
          created_by: string
          updated_at: string
          updated_by: string | null
          completed_at: string | null
          custom_properties: Record<string, unknown>
        }
        Insert: {
          id?: string
          org_id: string
          eco_number: string
          title?: string | null
          description?: string | null
          status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
          created_at?: string
          created_by: string
          updated_at?: string
          updated_by?: string | null
          completed_at?: string | null
          custom_properties?: Record<string, unknown>
        }
        Update: {
          id?: string
          org_id?: string
          eco_number?: string
          title?: string | null
          description?: string | null
          status?: 'open' | 'in_progress' | 'completed' | 'cancelled'
          created_at?: string
          created_by?: string
          updated_at?: string
          updated_by?: string | null
          completed_at?: string | null
          custom_properties?: Record<string, unknown>
        }
      }
      file_ecos: {
        Row: {
          id: string
          file_id: string
          eco_id: string
          created_at: string
          created_by: string
          notes: string | null
        }
        Insert: {
          id?: string
          file_id: string
          eco_id: string
          created_at?: string
          created_by: string
          notes?: string | null
        }
        Update: {
          id?: string
          file_id?: string
          eco_id?: string
          created_at?: string
          created_by?: string
          notes?: string | null
        }
      }
      // Reviews & Notifications tables
      reviews: {
        Row: {
          id: string
          org_id: string
          file_id: string
          vault_id: string | null
          requested_by: string
          requested_at: string
          title: string | null
          message: string | null
          file_version: number
          status: 'pending' | 'approved' | 'rejected' | 'cancelled'
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          file_id: string
          vault_id?: string | null
          requested_by: string
          requested_at?: string
          title?: string | null
          message?: string | null
          file_version: number
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string
          vault_id?: string | null
          requested_by?: string
          requested_at?: string
          title?: string | null
          message?: string | null
          file_version?: number
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      review_responses: {
        Row: {
          id: string
          review_id: string
          reviewer_id: string
          status: 'pending' | 'approved' | 'rejected' | 'cancelled'
          comment: string | null
          responded_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          review_id: string
          reviewer_id: string
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          comment?: string | null
          responded_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          review_id?: string
          reviewer_id?: string
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          comment?: string | null
          responded_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          org_id: string
          user_id: string
          type: 'review_request' | 'review_approved' | 'review_rejected' | 'review_comment' | 'mention' | 'file_updated'
          title: string
          message: string | null
          review_id: string | null
          file_id: string | null
          from_user_id: string | null
          read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          type: 'review_request' | 'review_approved' | 'review_rejected' | 'review_comment' | 'mention' | 'file_updated'
          title: string
          message?: string | null
          review_id?: string | null
          file_id?: string | null
          from_user_id?: string | null
          read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          type?: 'review_request' | 'review_approved' | 'review_rejected' | 'review_comment' | 'mention' | 'file_updated'
          title?: string
          message?: string | null
          review_id?: string | null
          file_id?: string | null
          from_user_id?: string | null
          read?: boolean
          read_at?: string | null
          created_at?: string
        }
      }
      // Workflow tables
      workflow_templates: {
        Row: {
          id: string
          org_id: string
          name: string
          description: string | null
          is_default: boolean
          is_active: boolean
          canvas_config: { zoom: number; panX: number; panY: number }
          created_at: string
          created_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          description?: string | null
          is_default?: boolean
          is_active?: boolean
          canvas_config?: { zoom: number; panX: number; panY: number }
          created_at?: string
          created_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          description?: string | null
          is_default?: boolean
          is_active?: boolean
          canvas_config?: { zoom: number; panX: number; panY: number }
          created_at?: string
          created_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
      }
      workflow_states: {
        Row: {
          id: string
          workflow_id: string
          name: string
          label: string | null
          description: string | null
          color: string
          icon: string
          position_x: number
          position_y: number
          state_type: 'initial' | 'intermediate' | 'final' | 'rejected'
          maps_to_file_state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          is_editable: boolean
          requires_checkout: boolean
          auto_increment_revision: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          workflow_id: string
          name: string
          label?: string | null
          description?: string | null
          color?: string
          icon?: string
          position_x?: number
          position_y?: number
          state_type?: 'initial' | 'intermediate' | 'final' | 'rejected'
          maps_to_file_state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          is_editable?: boolean
          requires_checkout?: boolean
          auto_increment_revision?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          workflow_id?: string
          name?: string
          label?: string | null
          description?: string | null
          color?: string
          icon?: string
          position_x?: number
          position_y?: number
          state_type?: 'initial' | 'intermediate' | 'final' | 'rejected'
          maps_to_file_state?: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
          is_editable?: boolean
          requires_checkout?: boolean
          auto_increment_revision?: boolean
          sort_order?: number
          created_at?: string
        }
      }
      workflow_transitions: {
        Row: {
          id: string
          workflow_id: string
          from_state_id: string
          to_state_id: string
          name: string | null
          description: string | null
          line_style: 'solid' | 'dashed' | 'dotted'
          line_color: string | null
          allowed_roles: ('admin' | 'engineer' | 'viewer')[]
          auto_conditions: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: string
          workflow_id: string
          from_state_id: string
          to_state_id: string
          name?: string | null
          description?: string | null
          line_style?: 'solid' | 'dashed' | 'dotted'
          line_color?: string | null
          allowed_roles?: ('admin' | 'engineer' | 'viewer')[]
          auto_conditions?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          workflow_id?: string
          from_state_id?: string
          to_state_id?: string
          name?: string | null
          description?: string | null
          line_style?: 'solid' | 'dashed' | 'dotted'
          line_color?: string | null
          allowed_roles?: ('admin' | 'engineer' | 'viewer')[]
          auto_conditions?: Record<string, unknown> | null
          created_at?: string
        }
      }
      workflow_gates: {
        Row: {
          id: string
          transition_id: string
          name: string
          description: string | null
          gate_type: 'approval' | 'checklist' | 'condition' | 'notification'
          required_approvals: number
          approval_mode: 'any' | 'all' | 'sequential'
          checklist_items: { id: string; label: string; required: boolean }[]
          conditions: Record<string, unknown> | null
          is_blocking: boolean
          can_be_skipped_by: ('admin' | 'engineer' | 'viewer')[]
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          transition_id: string
          name: string
          description?: string | null
          gate_type?: 'approval' | 'checklist' | 'condition' | 'notification'
          required_approvals?: number
          approval_mode?: 'any' | 'all' | 'sequential'
          checklist_items?: { id: string; label: string; required: boolean }[]
          conditions?: Record<string, unknown> | null
          is_blocking?: boolean
          can_be_skipped_by?: ('admin' | 'engineer' | 'viewer')[]
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          transition_id?: string
          name?: string
          description?: string | null
          gate_type?: 'approval' | 'checklist' | 'condition' | 'notification'
          required_approvals?: number
          approval_mode?: 'any' | 'all' | 'sequential'
          checklist_items?: { id: string; label: string; required: boolean }[]
          conditions?: Record<string, unknown> | null
          is_blocking?: boolean
          can_be_skipped_by?: ('admin' | 'engineer' | 'viewer')[]
          sort_order?: number
          created_at?: string
        }
      }
      workflow_gate_reviewers: {
        Row: {
          id: string
          gate_id: string
          reviewer_type: 'user' | 'role' | 'group' | 'file_owner' | 'checkout_user'
          user_id: string | null
          role: 'admin' | 'engineer' | 'viewer' | null
          group_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          gate_id: string
          reviewer_type: 'user' | 'role' | 'group' | 'file_owner' | 'checkout_user'
          user_id?: string | null
          role?: 'admin' | 'engineer' | 'viewer' | null
          group_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          gate_id?: string
          reviewer_type?: 'user' | 'role' | 'group' | 'file_owner' | 'checkout_user'
          user_id?: string | null
          role?: 'admin' | 'engineer' | 'viewer' | null
          group_name?: string | null
          created_at?: string
        }
      }
      file_workflow_assignments: {
        Row: {
          id: string
          file_id: string
          workflow_id: string
          current_state_id: string | null
          assigned_at: string
          assigned_by: string | null
        }
        Insert: {
          id?: string
          file_id: string
          workflow_id: string
          current_state_id?: string | null
          assigned_at?: string
          assigned_by?: string | null
        }
        Update: {
          id?: string
          file_id?: string
          workflow_id?: string
          current_state_id?: string | null
          assigned_at?: string
          assigned_by?: string | null
        }
      }
      pending_reviews: {
        Row: {
          id: string
          org_id: string
          file_id: string
          transition_id: string
          gate_id: string
          requested_by: string
          requested_at: string
          status: 'pending' | 'approved' | 'rejected' | 'cancelled'
          assigned_to: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          review_comment: string | null
          checklist_responses: Record<string, boolean>
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          file_id: string
          transition_id: string
          gate_id: string
          requested_by: string
          requested_at?: string
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          assigned_to?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_comment?: string | null
          checklist_responses?: Record<string, boolean>
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string
          transition_id?: string
          gate_id?: string
          requested_by?: string
          requested_at?: string
          status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
          assigned_to?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_comment?: string | null
          checklist_responses?: Record<string, boolean>
          expires_at?: string | null
          created_at?: string
        }
      }
      workflow_review_history: {
        Row: {
          id: string
          org_id: string
          file_id: string | null
          file_path: string
          file_name: string
          workflow_id: string | null
          workflow_name: string
          transition_id: string | null
          from_state_name: string
          to_state_name: string
          gate_id: string | null
          gate_name: string
          requested_by: string | null
          requested_by_email: string
          requested_at: string
          reviewed_by: string | null
          reviewed_by_email: string
          reviewed_at: string
          decision: string
          comment: string | null
          checklist_responses: Record<string, boolean> | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          file_id?: string | null
          file_path: string
          file_name: string
          workflow_id?: string | null
          workflow_name: string
          transition_id?: string | null
          from_state_name: string
          to_state_name: string
          gate_id?: string | null
          gate_name: string
          requested_by?: string | null
          requested_by_email: string
          requested_at: string
          reviewed_by?: string | null
          reviewed_by_email: string
          reviewed_at: string
          decision: string
          comment?: string | null
          checklist_responses?: Record<string, boolean> | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string | null
          file_path?: string
          file_name?: string
          workflow_id?: string | null
          workflow_name?: string
          transition_id?: string | null
          from_state_name?: string
          to_state_name?: string
          gate_id?: string | null
          gate_name?: string
          requested_by?: string | null
          requested_by_email?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_by_email?: string
          reviewed_at?: string
          decision?: string
          comment?: string | null
          checklist_responses?: Record<string, boolean> | null
          created_at?: string
        }
      }
      // Backup configuration
      backup_config: {
        Row: {
          id: string
          org_id: string
          provider: 'backblaze_b2' | 'aws_s3' | 'google_cloud'
          bucket: string | null
          region: string | null
          endpoint: string | null
          access_key_encrypted: string | null
          secret_key_encrypted: string | null
          restic_password_encrypted: string | null
          retention_daily: number
          retention_weekly: number
          retention_monthly: number
          retention_yearly: number
          schedule_enabled: boolean
          schedule_hour: number
          schedule_minute: number
          schedule_timezone: string
          designated_machine_id: string | null
          designated_machine_name: string | null
          designated_machine_platform: string | null
          designated_machine_user_email: string | null
          designated_machine_last_seen: string | null
          backup_requested_at: string | null
          backup_requested_by: string | null
          backup_running_since: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider?: 'backblaze_b2' | 'aws_s3' | 'google_cloud'
          bucket?: string | null
          region?: string | null
          endpoint?: string | null
          access_key_encrypted?: string | null
          secret_key_encrypted?: string | null
          restic_password_encrypted?: string | null
          retention_daily?: number
          retention_weekly?: number
          retention_monthly?: number
          retention_yearly?: number
          schedule_enabled?: boolean
          schedule_hour?: number
          schedule_minute?: number
          schedule_timezone?: string
          designated_machine_id?: string | null
          designated_machine_name?: string | null
          designated_machine_platform?: string | null
          designated_machine_user_email?: string | null
          designated_machine_last_seen?: string | null
          backup_requested_at?: string | null
          backup_requested_by?: string | null
          backup_running_since?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          provider?: 'backblaze_b2' | 'aws_s3' | 'google_cloud'
          bucket?: string | null
          region?: string | null
          endpoint?: string | null
          access_key_encrypted?: string | null
          secret_key_encrypted?: string | null
          restic_password_encrypted?: string | null
          retention_daily?: number
          retention_weekly?: number
          retention_monthly?: number
          retention_yearly?: number
          schedule_enabled?: boolean
          schedule_hour?: number
          schedule_minute?: number
          schedule_timezone?: string
          designated_machine_id?: string | null
          designated_machine_name?: string | null
          designated_machine_platform?: string | null
          designated_machine_user_email?: string | null
          designated_machine_last_seen?: string | null
          backup_requested_at?: string | null
          backup_requested_by?: string | null
          backup_running_since?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      // File watchers
      file_watchers: {
        Row: {
          id: string
          org_id: string
          file_id: string
          user_id: string
          notify_on_checkin: boolean
          notify_on_checkout: boolean
          notify_on_state_change: boolean
          notify_on_review: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          file_id: string
          user_id: string
          notify_on_checkin?: boolean
          notify_on_checkout?: boolean
          notify_on_state_change?: boolean
          notify_on_review?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string
          user_id?: string
          notify_on_checkin?: boolean
          notify_on_checkout?: boolean
          notify_on_state_change?: boolean
          notify_on_review?: boolean
          created_at?: string
        }
      }
      // File share links
      file_share_links: {
        Row: {
          id: string
          org_id: string
          file_id: string
          token: string
          created_by: string
          expires_at: string | null
          max_downloads: number | null
          download_count: number
          password_hash: string | null
          file_version: number | null
          allow_download: boolean
          require_auth: boolean
          created_at: string
          last_accessed_at: string | null
          is_active: boolean
        }
        Insert: {
          id?: string
          org_id: string
          file_id: string
          token: string
          created_by: string
          expires_at?: string | null
          max_downloads?: number | null
          download_count?: number
          password_hash?: string | null
          file_version?: number | null
          allow_download?: boolean
          require_auth?: boolean
          created_at?: string
          last_accessed_at?: string | null
          is_active?: boolean
        }
        Update: {
          id?: string
          org_id?: string
          file_id?: string
          token?: string
          created_by?: string
          expires_at?: string | null
          max_downloads?: number | null
          download_count?: number
          password_hash?: string | null
          file_version?: number | null
          allow_download?: boolean
          require_auth?: boolean
          created_at?: string
          last_accessed_at?: string | null
          is_active?: boolean
        }
      }
      // File comments (optional)
      file_comments: {
        Row: {
          id: string
          file_id: string
          user_id: string
          comment: string
          created_at: string
        }
        Insert: {
          id?: string
          file_id: string
          user_id: string
          comment: string
          created_at?: string
        }
        Update: {
          id?: string
          file_id?: string
          user_id?: string
          comment?: string
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      create_default_workflow: {
        Args: { p_org_id: string; p_created_by: string }
        Returns: string
      }
      get_available_transitions: {
        Args: { p_file_id: string }
        Returns: Array<{
          transition_id: string
          transition_name: string | null
          to_state_id: string
          to_state_name: string
          to_state_color: string
          has_gates: boolean
          user_can_transition: boolean
        }>
      }
      get_my_pending_reviews: {
        Args: Record<string, never>
        Returns: Array<unknown>
      }
      update_backup_heartbeat: {
        Args: { p_org_id: string; p_machine_id: string }
        Returns: boolean
      }
      request_backup: {
        Args: { p_org_id: string; p_requested_by: string }
        Returns: boolean
      }
      start_backup: {
        Args: { p_org_id: string; p_machine_id: string }
        Returns: boolean
      }
      complete_backup: {
        Args: { p_org_id: string; p_machine_id: string }
        Returns: boolean
      }
    }
    Enums: {
      file_state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
      file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
      reference_type: 'component' | 'drawing_view' | 'derived' | 'copy'
      user_role: 'admin' | 'engineer' | 'viewer'
      revision_scheme: 'letter' | 'numeric'
      activity_action: 'checkout' | 'checkin' | 'create' | 'delete' | 'restore' | 'state_change' | 'revision_change' | 'rename' | 'move' | 'rollback' | 'roll_forward'
      eco_status: 'open' | 'in_progress' | 'completed' | 'cancelled'
      review_status: 'pending' | 'approved' | 'rejected' | 'cancelled'
      notification_type: 'review_request' | 'review_approved' | 'review_rejected' | 'review_comment' | 'mention' | 'file_updated' | 'checkout_request'
      workflow_state_type: 'initial' | 'intermediate' | 'final' | 'rejected'
      gate_type: 'approval' | 'checklist' | 'condition' | 'notification'
      approval_mode: 'any' | 'all' | 'sequential'
      reviewer_type: 'user' | 'role' | 'group' | 'file_owner' | 'checkout_user'
      transition_line_style: 'solid' | 'dashed' | 'dotted'
    }
    CompositeTypes: Record<string, never>
  }
}

// ===========================================
// Reviews & Notifications Types
// ===========================================

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type NotificationType = 'review_request' | 'review_approved' | 'review_rejected' | 'review_comment' | 'mention' | 'file_updated' | 'checkout_request'

export interface Review {
  id: string
  org_id: string
  file_id: string
  vault_id: string | null
  requested_by: string
  requested_at: string
  title: string | null
  message: string | null
  file_version: number
  status: ReviewStatus
  due_date: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  completed_at: string | null
  created_at: string
  updated_at: string
  // Joined fields
  file?: {
    file_name: string
    file_path: string
    extension: string
  }
  requester?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  }
  responses?: ReviewResponse[]
}

export interface ReviewResponse {
  id: string
  review_id: string
  reviewer_id: string
  status: ReviewStatus
  comment: string | null
  responded_at: string | null
  created_at: string
  updated_at: string
  // Joined fields
  reviewer?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  }
}

export interface Notification {
  id: string
  org_id: string
  user_id: string
  type: NotificationType
  title: string
  message: string | null
  review_id: string | null
  file_id: string | null
  from_user_id: string | null
  read: boolean
  read_at: string | null
  created_at: string
  // Joined fields
  from_user?: {
    email: string
    full_name: string | null
    avatar_url: string | null
  }
  review?: Review
  file?: {
    file_name: string
    file_path: string
  }
}

