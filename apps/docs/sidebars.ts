import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  manualSidebar: [
    {
      type: 'category',
      label: 'Primeiros Passos',
      collapsed: false,
      items: [
        'introduction',
        'architecture',
        'war-room',
        'demo-modes',
        'human-approval',
        'scope-and-limits'
      ]
    },
    {
      type: 'category',
      label: 'Operação e Integração',
      collapsed: false,
      items: ['settings', 'connect-service', 'mcp-clients', 'installation-troubleshooting']
    }
  ]
};

export default sidebars;
