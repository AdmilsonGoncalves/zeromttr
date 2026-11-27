import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const docsUrl = process.env.ZEROMTTR_DOCS_URL || 'https://docs.zeromttr.agjworks.com';
const dashboardUrl = process.env.PUBLIC_DASHBOARD_URL || 'https://zeromttr.agjworks.com';

const LOCALE_METADATA: Record<string, { title: string; tagline: string }> = {
  'pt-BR': {
    title: 'ZeroMTTR — Manual de Instruções',
    tagline: 'Remediação Autônoma de Incidentes & Governança Humana'
  },
  'en-US': {
    title: 'ZeroMTTR — User Manual',
    tagline: 'Autonomous Incident Remediation & Human Governance'
  },
  'es-ES': {
    title: 'ZeroMTTR — Manual de Usuario',
    tagline: 'Remediación Autónoma de Incidentes y Gobernanza Humana'
  }
};

const currentLocale = process.env.DOCUSAURUS_CURRENT_LOCALE || 'pt-BR';
const activeMetadata = LOCALE_METADATA[currentLocale] ?? LOCALE_METADATA['pt-BR'];

const config: Config = {
  title: activeMetadata.title,
  tagline: activeMetadata.tagline,
  favicon: 'img/logo.svg',

  url: docsUrl,
  baseUrl: '/',

  organizationName: 'AdmilsonGoncalves',
  projectName: 'zeromttr',

  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw'
    }
  },
  themes: ['@docusaurus/theme-mermaid'],

  i18n: {
    defaultLocale: 'pt-BR',
    locales: ['pt-BR', 'en-US', 'es-ES'],
    localeConfigs: {
      'pt-BR': {
        label: 'Português (BR)',
        htmlLang: 'pt-BR'
      },
      'en-US': {
        label: 'English (US)',
        htmlLang: 'en-US'
      },
      'es-ES': {
        label: 'Español (ES)',
        htmlLang: 'es-ES'
      }
    }
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'manuals',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts'
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css'
        }
      } satisfies Preset.Options
    ]
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true
    },
    navbar: {
      title: 'ZeroMTTR Manual',
      logo: {
        alt: 'ZeroMTTR Shield Logo',
        src: 'img/logo.svg'
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'manualSidebar',
          position: 'left',
          label: 'Guia do Usuário'
        },
        {
          href: dashboardUrl,
          label: 'War Room',
          position: 'right'
        },
        {
          href: 'https://github.com/AdmilsonGoncalves/zeromttr',
          label: 'GitHub',
          position: 'right'
        },
        {
          type: 'localeDropdown',
          position: 'right'
        }
      ]
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Manual',
          items: [
            {
              label: 'Introdução',
              to: '/'
            },
            {
              label: 'Arquitetura do Sistema',
              to: '/architecture'
            },
            {
              label: 'Usando o War Room',
              to: '/war-room'
            },
            {
              label: 'Conectando seu Serviço',
              to: '/connect-service'
            }
          ]
        },
        {
          title: 'Plataforma',
          items: [
            {
              label: 'War Room Dashboard',
              href: dashboardUrl
            },
            {
              label: 'Repositório GitHub',
              href: 'https://github.com/AdmilsonGoncalves/zeromttr'
            },
            {
              label: 'Documentação de Engenharia',
              href: 'https://github.com/AdmilsonGoncalves/zeromttr/tree/master/docs'
            }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AGJ Works — ZeroMTTR.`
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'nginx']
    }
  } satisfies Preset.ThemeConfig
};

export default config;
