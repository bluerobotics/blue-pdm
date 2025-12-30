import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'BluePLM Docs',
  description: 'Documentation for BluePLM - Open-source Product Lifecycle Management',
  
  head: [
    ['link', { rel: 'icon', href: '/icon.svg' }],
  ],

  themeConfig: {
    logo: '/icon.svg',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Settings', link: '/settings/' },
      { text: 'blueplm.io', link: 'https://blueplm.io' },
    ],

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

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bluerobotics/bluePLM' },
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/bluerobotics/bluePLM/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 Blue Robotics'
    }
  }
})
