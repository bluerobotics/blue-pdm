import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'BluePLM Docs',
  description: 'BluePLM Documentation',
  
  themeConfig: {
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/getting-started' },
          { text: 'Admin Setup', link: '/admin-setup' },
          { text: 'User Setup', link: '/user-setup' },
        ]
      },
      {
        text: 'Source Files',
        items: [
          { text: 'Explorer', link: '/source-files/explorer' },
          { text: 'Vaults', link: '/source-files/vaults' },
        ]
      },
      {
        text: 'Settings',
        items: [
          { text: 'Overview', link: '/settings/' },
          { text: 'Account', link: '/settings/account' },
          { text: 'Organization', link: '/settings/organization' },
          { text: 'Integrations', link: '/settings/integrations' },
        ]
      }
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/bluerobotics/bluePLM/edit/main/docs/:path',
      text: 'Edit this page'
    }
  }
})
