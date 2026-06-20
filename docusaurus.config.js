// @ts-check

const repositoryName = process.env.GITHUB_REPOSITORY
  ? process.env.GITHUB_REPOSITORY.split('/')[1]
  : 'human-host-wiki';
const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || 'your-github-name';
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true';

const config = {
  title: 'Human Host Wiki',
  tagline: 'Early access survival crafting notes and update tracking',
  favicon: 'img/favicon.ico',

  url: process.env.SITE_URL || `https://${repositoryOwner}.github.io`,
  baseUrl: process.env.BASE_URL || (isGitHubPagesBuild ? `/${repositoryName}/` : '/'),

  organizationName: repositoryOwner,
  projectName: repositoryName,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    }
  },

  i18n: {
    defaultLocale: 'ja',
    locales: ['ja'],
    localeConfigs: {
      ja: {
        label: '日本語',
        direction: 'ltr'
      }
    }
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          routeBasePath: '/'
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css')
        }
      }
    ]
  ],

  themeConfig: {
    navbar: {
      title: 'Human Host Wiki',
      items: [
        {to: '/', label: 'トップ', position: 'left'},
        {to: '/biomes', label: 'バイオーム', position: 'left'},
        {to: '/resources', label: '資源', position: 'left'},
        {to: '/items', label: 'アイテム', position: 'left'},
        {to: '/updates', label: '更新履歴', position: 'left'},
        {
          href: 'https://github.com/',
          label: 'GitHub',
          position: 'right'
        }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Wiki',
          items: [
            {label: 'トップ', to: '/'},
            {label: '未確認情報', to: '/unconfirmed'},
            {label: '用語集', to: '/glossary'}
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Human Host Wiki.`
    },
    prism: {
      additionalLanguages: ['yaml']
    }
  }
};

module.exports = config;
