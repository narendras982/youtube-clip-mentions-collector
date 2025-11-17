import React, { useState, useEffect } from 'react';
import { Layout, Card, Row, Col, Statistic, Alert, Badge, Button, Table, Tag, Spin, notification, Progress } from 'antd';
import { 
  DesktopOutlined, 
  PlayCircleOutlined, 
  MessageOutlined, 
  HeartOutlined,
  ReloadOutlined,
  BarChartOutlined,
  GlobalOutlined
} from '@ant-design/icons';
// Charts temporarily disabled due to dependency issues
// import { Line, Pie, Bar } from '@ant-design/charts';
import moment from 'moment';
import { feedsApi, mentionApi, sentimentApi, mentionsApi } from '../services/api';

const { Header, Content, Sider } = Layout;

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState({
    mention: { status: 'unknown', health: null },
    sentiment: { status: 'unknown', health: null },
    backend: { status: 'unknown', health: null }
  });
  const [stats, setStats] = useState({
    totalFeeds: 0,
    activeFeeds: 0,
    totalMentions: 0,
    recentMentions: [],
    sentimentDistribution: [],
    languageDistribution: [],
    feedStats: []
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    initializeDashboard();
  }, []);

  const initializeDashboard = async () => {
    setLoading(true);
    try {
      await Promise.all([
        checkServiceHealth(),
        loadDashboardStats(),
        loadRecentActivity()
      ]);
    } catch (error) {
      console.error('Dashboard initialization failed:', error);
      notification.error({
        message: 'Dashboard Error',
        description: 'Failed to initialize dashboard. Please check service connectivity.',
      });
    } finally {
      setLoading(false);
    }
  };

  const checkServiceHealth = async () => {
    const healthChecks = {
      mention: mentionApi.healthCheck(),
      sentiment: sentimentApi.healthCheck(),
      backend: feedsApi.getFeeds().then(() => ({ status: 'healthy' })).catch(e => ({ status: 'unhealthy', error: e.message }))
    };

    const results = await Promise.allSettled(Object.entries(healthChecks).map(
      ([service, promise]) => promise.then(
        result => ({ service, status: 'healthy', health: result.data || result }),
        error => ({ service, status: 'unhealthy', error: error.message })
      )
    ));

    const serviceStatus = {};
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        const { service, status, health, error } = result.value;
        serviceStatus[service] = { status, health, error };
      }
    });

    setServices(serviceStatus);
  };

  const loadDashboardStats = async () => {
    try {
      const [feedsResponse, mentionStats, sentimentStats] = await Promise.allSettled([
        feedsApi.getFeeds(),
        mentionApi.getStats(),
        sentimentApi.getStats()
      ]);

      let dashboardStats = {
        totalFeeds: 0,
        activeFeeds: 0,
        totalMentions: 0,
        recentMentions: [],
        sentimentDistribution: [],
        languageDistribution: [],
        feedStats: []
      };

      // Process feeds data
      if (feedsResponse.status === 'fulfilled') {
        const feedData = feedsResponse.value?.data?.data || feedsResponse.value?.data || [];
        const feeds = Array.isArray(feedData) ? feedData : [];
        dashboardStats.totalFeeds = feeds.length;
        dashboardStats.activeFeeds = feeds.filter(f => f.isActive).length;
        dashboardStats.feedStats = feeds.map(feed => ({
          name: feed.name,
          language: feed.language,
          status: feed.isActive ? 'Active' : 'Inactive',
          lastPolled: feed.lastPolled ? moment(feed.lastPolled).format('HH:mm:ss') : 'Never',
          entries: feed.stats?.totalEntries || 0,
          mentions: feed.stats?.totalMentions || 0
        }));
      }

      // Process mention service stats
      if (mentionStats.status === 'fulfilled') {
        const stats = mentionStats.value.data || {};
        dashboardStats.totalMentions = stats.total_requests || 0;
        
        // Language distribution from mention service
        if (stats.by_language) {
          dashboardStats.languageDistribution = Object.entries(stats.by_language).map(([lang, count]) => ({
            language: lang === 'en' ? 'English' : lang === 'hi' ? 'Hindi' : lang === 'mr' ? 'Marathi' : lang,
            count: count,
            percentage: ((count / dashboardStats.totalMentions) * 100).toFixed(1)
          }));
        }
      }

      // Process sentiment stats
      if (sentimentStats.status === 'fulfilled') {
        const stats = sentimentStats.value.data || {};
        
        // Simulate sentiment distribution
        dashboardStats.sentimentDistribution = [
          { sentiment: 'Positive', count: Math.floor(stats.total_requests * 0.4) || 120, color: '#52c41a' },
          { sentiment: 'Neutral', count: Math.floor(stats.total_requests * 0.35) || 105, color: '#1890ff' },
          { sentiment: 'Negative', count: Math.floor(stats.total_requests * 0.25) || 75, color: '#ff4d4f' }
        ];
      }

      setStats(dashboardStats);
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
    }
  };

  const loadRecentActivity = async () => {
    // Simulate recent activity data
    const activities = [
      {
        id: 1,
        type: 'mention',
        title: 'New mention detected in Zee 24 Taas',
        description: 'Keyword "महाराष्ट्र" found in video about state politics',
        timestamp: moment().subtract(5, 'minutes'),
        language: 'mr',
        sentiment: 'neutral'
      },
      {
        id: 2,
        type: 'feed',
        title: 'ABP Majha feed processed',
        description: '12 new videos analyzed, 3 mentions found',
        timestamp: moment().subtract(15, 'minutes'),
        language: 'mr',
        sentiment: 'mixed'
      },
      {
        id: 3,
        type: 'mention',
        title: 'High-confidence mention in TV9 Marathi',
        description: 'Multiple keywords detected discussing Mumbai infrastructure',
        timestamp: moment().subtract(32, 'minutes'),
        language: 'mr',
        sentiment: 'positive'
      },
      {
        id: 4,
        type: 'system',
        title: 'Models reloaded successfully',
        description: 'Mention detection and sentiment analysis models updated',
        timestamp: moment().subtract(45, 'minutes'),
        language: 'system',
        sentiment: 'success'
      }
    ];

    setRecentActivity(activities);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await initializeDashboard();
      notification.success({
        message: 'Dashboard Refreshed',
        description: 'All data has been updated successfully.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const getServiceStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'unhealthy': return 'error';
      default: return 'default';
    }
  };

  const getLanguageFlag = (language) => {
    switch (language) {
      case 'en': return '🇺🇸';
      case 'hi': return '🇮🇳';
      case 'mr': return '🏴󠁭󠁨󠁸󠁸󠁿';
      default: return '🌐';
    }
  };

  const feedColumns = [
    {
      title: 'Feed Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 'bold' }}>{getLanguageFlag(record.language)} {text}</div>
          <Tag color={record.status === 'Active' ? 'green' : 'red'}>{record.status}</Tag>
        </div>
      )
    },
    {
      title: 'Last Polled',
      dataIndex: 'lastPolled',
      key: 'lastPolled'
    },
    {
      title: 'Entries',
      dataIndex: 'entries',
      key: 'entries',
      render: (count) => <Statistic value={count} valueStyle={{ fontSize: '14px' }} />
    },
    {
      title: 'Mentions',
      dataIndex: 'mentions',
      key: 'mentions',
      render: (count) => <Statistic value={count} valueStyle={{ fontSize: '14px', color: count > 0 ? '#52c41a' : undefined }} />
    }
  ];

  const activityColumns = [
    {
      title: 'Activity',
      dataIndex: 'title',
      key: 'title',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 'bold' }}>{text}</div>
          <div style={{ color: '#666', fontSize: '12px' }}>{record.description}</div>
        </div>
      )
    },
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (timestamp) => moment(timestamp).fromNow()
    },
    {
      title: 'Language',
      dataIndex: 'language',
      key: 'language',
      render: (lang) => lang === 'system' ? 
        <Tag color="purple">System</Tag> : 
        <Tag color="blue">{getLanguageFlag(lang)} {lang.toUpperCase()}</Tag>
    }
  ];

  if (loading) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content style={{ padding: '50px', textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: '20px' }}>Loading Dashboard...</div>
        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', color: 'white', padding: '0 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
          <h2 style={{ color: 'white', margin: 0 }}>
            <GlobalOutlined style={{ marginRight: '10px' }} />
            YouTube Mentions Dashboard - Maharashtra
          </h2>
          <Button 
            type="primary" 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        </div>
      </Header>

      <Layout>
        <Content style={{ padding: '20px' }}>
          {/* Service Status Alert */}
          <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
            <Col span={24}>
              <Alert
                message="Service Status"
                description={
                  <div style={{ display: 'flex', gap: '20px' }}>
                    <Badge status={getServiceStatusColor(services.mention?.status)} text={`Mention Detection: ${services.mention?.status || 'Unknown'}`} />
                    <Badge status={getServiceStatusColor(services.sentiment?.status)} text={`Sentiment Analysis: ${services.sentiment?.status || 'Unknown'}`} />
                    <Badge status={getServiceStatusColor(services.backend?.status)} text={`Backend API: ${services.backend?.status || 'Unknown'}`} />
                  </div>
                }
                type={Object.values(services).every(s => s.status === 'healthy') ? 'success' : 'warning'}
                showIcon
              />
            </Col>
          </Row>

          {/* Key Metrics */}
          <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic
                  title="Total RSS Feeds"
                  value={stats.totalFeeds}
                  prefix={<DesktopOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic
                  title="Active Feeds"
                  value={stats.activeFeeds}
                  prefix={<PlayCircleOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic
                  title="Total Mentions"
                  value={stats.totalMentions}
                  prefix={<MessageOutlined />}
                  valueStyle={{ color: '#fa8c16' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card>
                <Statistic
                  title="Avg Sentiment"
                  value="Neutral"
                  prefix={<HeartOutlined />}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Card>
            </Col>
          </Row>

          {/* Charts Row */}
          <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
            <Col xs={24} lg={12}>
              <Card title={<><BarChartOutlined /> Language Distribution</>}>
                {stats.languageDistribution.length > 0 ? (
                  <div style={{ padding: '20px' }}>
                    {stats.languageDistribution.map((item, index) => (
                      <div key={index} style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold' }}>{item.language}</span>
                          <span>{item.count} ({item.percentage}%)</span>
                        </div>
                        <Progress 
                          percent={parseFloat(item.percentage)} 
                          strokeColor={index === 0 ? '#52c41a' : index === 1 ? '#1890ff' : '#fa8c16'}
                          showInfo={false}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '50px' }}>
                    No language data available
                  </div>
                )}
              </Card>
            </Col>
            
            <Col xs={24} lg={12}>
              <Card title={<><HeartOutlined /> Sentiment Distribution</>}>
                {stats.sentimentDistribution.length > 0 ? (
                  <div style={{ padding: '20px' }}>
                    {stats.sentimentDistribution.map((item, index) => (
                      <div key={index} style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Tag color={item.color} style={{ margin: 0 }}>{item.sentiment}</Tag>
                          <span style={{ fontWeight: 'bold' }}>{item.count}</span>
                        </div>
                        <Progress 
                          percent={(item.count / Math.max(...stats.sentimentDistribution.map(d => d.count))) * 100} 
                          strokeColor={item.color}
                          showInfo={false}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '50px' }}>
                    No sentiment data available
                  </div>
                )}
              </Card>
            </Col>
          </Row>

          {/* Tables Row */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="RSS Feed Status" extra={<Tag color="blue">Maharashtra Channels</Tag>}>
                <Table
                  columns={feedColumns}
                  dataSource={stats.feedStats}
                  pagination={false}
                  size="small"
                  scroll={{ y: 300 }}
                />
              </Card>
            </Col>
            
            <Col xs={24} lg={10}>
              <Card title="Recent Activity">
                <Table
                  columns={activityColumns}
                  dataSource={recentActivity}
                  pagination={false}
                  size="small"
                  scroll={{ y: 300 }}
                />
              </Card>
            </Col>
          </Row>
        </Content>
      </Layout>
    </Layout>
  );
};

export default Dashboard;