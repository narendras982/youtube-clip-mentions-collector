import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, Menu, Typography, Badge, Avatar } from 'antd';
import {
  DashboardOutlined,
  SearchOutlined,
  YoutubeOutlined,
  SettingOutlined,
  BarChartOutlined,
  GlobalOutlined,
  DatabaseOutlined
} from '@ant-design/icons';
import { QueryClient, QueryClientProvider } from 'react-query';
import 'antd/dist/reset.css';

import Dashboard from './components/Dashboard';
import MentionDetection from './components/MentionDetection';
import RSSFeedsManager from './components/RSSFeedsManager';
import MentionsManager from './components/MentionsManager';

const { Header, Content, Sider } = Layout;
const { Title } = Typography;

// Create a query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

const App = () => {
  const [selectedKey, setSelectedKey] = React.useState('dashboard');

  const menuItems = [
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    {
      key: 'mention-detection',
      icon: <SearchOutlined />,
      label: 'Mention Detection',
    },
    {
      key: 'mentions-manager',
      icon: <DatabaseOutlined />,
      label: 'Mentions Manager',
    },
    {
      key: 'rss-feeds',
      icon: <YoutubeOutlined />,
      label: 'RSS Feeds',
    },
    {
      key: 'analytics',
      icon: <BarChartOutlined />,
      label: 'Analytics',
      disabled: true
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      disabled: true
    }
  ];

  const renderContent = () => {
    switch (selectedKey) {
      case 'dashboard':
        return <Dashboard />;
      case 'mention-detection':
        return <MentionDetection />;
      case 'mentions-manager':
        return <MentionsManager />;
      case 'rss-feeds':
        return <RSSFeedsManager />;
      case 'analytics':
        return (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <BarChartOutlined style={{ fontSize: '64px', color: '#ccc' }} />
            <h2>Analytics Coming Soon</h2>
            <p>Advanced analytics and reporting features will be available in the next release.</p>
          </div>
        );
      case 'settings':
        return (
          <div style={{ padding: '50px', textAlign: 'center' }}>
            <SettingOutlined style={{ fontSize: '64px', color: '#ccc' }} />
            <h2>Settings Coming Soon</h2>
            <p>Configuration and settings panel will be available in the next release.</p>
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          width={250}
          style={{
            background: '#001529',
            position: 'fixed',
            height: '100vh',
            left: 0,
            top: 0,
            bottom: 0,
          }}
        >
          <div style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #303030' }}>
            <Avatar 
              size={40} 
              style={{ backgroundColor: '#1890ff', marginBottom: '8px' }}
              icon={<GlobalOutlined />}
            />
            <div style={{ color: 'white', fontSize: '14px', fontWeight: 'bold' }}>
              YouTube Mentions
            </div>
            <div style={{ color: '#999', fontSize: '12px' }}>
              Maharashtra Monitoring
            </div>
          </div>
          
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            style={{ marginTop: '8px' }}
            onClick={({ key }) => setSelectedKey(key)}
          />
          
          <div style={{ 
            position: 'absolute', 
            bottom: '20px', 
            left: '20px', 
            right: '20px',
            padding: '12px',
            background: '#1f1f1f',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#666'
          }}>
            <div style={{ marginBottom: '4px' }}>
              <Badge status="success" text="Services Online" />
            </div>
            <div>Phase 6: Mentions Management</div>
          </div>
        </Sider>

        <Layout style={{ marginLeft: 250 }}>
          <Content style={{ backgroundColor: '#f0f2f5' }}>
            {renderContent()}
          </Content>
        </Layout>
      </Layout>
    </QueryClientProvider>
  );
};

export default App;