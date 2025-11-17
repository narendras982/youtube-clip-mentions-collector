import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Form,
  Input,
  Select,
  Modal,
  Tag,
  Switch,
  Space,
  Popconfirm,
  notification,
  Alert,
  Row,
  Col,
  Statistic,
  Typography,
  Tooltip,
  Progress,
  Badge
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ImportOutlined,
  SettingOutlined,
  YoutubeOutlined,
  GlobalOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import moment from 'moment';
import { feedsApi, MAHARASHTRA_FEEDS } from '../services/api';
import VideoListModal from './VideoListModal';

const { Option } = Select;
const { Title, Text } = Typography;

const RSSFeedsManager = () => {
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingFeed, setEditingFeed] = useState(null);
  const [form] = Form.useForm();
  const [importLoading, setImportLoading] = useState(false);
  const [pollingFeed, setPollingFeed] = useState(null);
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [selectedFeedForVideos, setSelectedFeedForVideos] = useState(null);

  useEffect(() => {
    loadFeeds();
  }, []);

  const loadFeeds = async () => {
    setLoading(true);
    try {
      const response = await feedsApi.getFeeds();
      console.log('API Response:', response.data); // Debug log
      
      let feedData = [];
      if (response?.data?.success && response?.data?.data?.docs) {
        // Handle paginated response structure
        feedData = response.data.data.docs;
      } else if (response?.data?.data && Array.isArray(response.data.data)) {
        feedData = response.data.data;
      } else if (Array.isArray(response?.data)) {
        feedData = response.data;
      }
      
      // Map backend field names to frontend expectations
      const mappedFeeds = feedData.map(feed => ({
        ...feed,
        // Map backend fields to frontend field names
        isActive: feed.enabled,
        lastPolled: feed.last_checked,
        refreshInterval: Math.round((feed.refresh_interval || 3600) / 60), // Convert seconds to minutes
        stats: {
          totalEntries: feed.statistics?.total_items_processed || 0,
          totalMentions: 0, // This would come from mentions collection
          errors: feed.statistics?.error_count || 0
        },
        language: feed.language || 'mr', // Default to Marathi
        priority: feed.priority || 'medium',
        category: feed.category || (feed.name?.includes('Taas') || feed.name?.includes('Majha') || feed.name?.includes('Marathi') ? 'maharashtra-youtube' : 'general'),
        // Extract YouTube channel URL from RSS feed URL
        youtubeChannelUrl: feed.channel_id ? `https://www.youtube.com/channel/${feed.channel_id}` : null
      }));
      
      console.log('Mapped feeds:', mappedFeeds); // Debug log
      setFeeds(mappedFeeds);
    } catch (error) {
      console.error('Failed to load feeds:', error);
      setFeeds([]);
      notification.error({
        message: 'Load Error',
        description: 'Failed to load RSS feeds. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddEdit = async (values) => {
    try {
      // Map frontend fields to backend fields
      const backendValues = {
        name: values.name,
        url: values.url,
        description: values.description,
        enabled: values.isActive !== false, // Default to true if not specified
        refresh_interval: (values.refreshInterval || 60) * 60, // Convert minutes to seconds
        keywords: typeof values.keywords === 'string' 
          ? values.keywords.split(',').map(k => k.trim()).filter(k => k)
          : values.keywords || [],
        language: values.language,
        priority: values.priority,
        category: values.category
      };
      
      console.log('Sending to backend:', backendValues); // Debug log
      
      if (editingFeed) {
        await feedsApi.updateFeed(editingFeed._id, backendValues);
        notification.success({
          message: 'Feed Updated',
          description: 'RSS feed updated successfully.'
        });
      } else {
        await feedsApi.addFeed(backendValues);
        notification.success({
          message: 'Feed Added',
          description: 'RSS feed added successfully.'
        });
      }
      
      setModalVisible(false);
      setEditingFeed(null);
      form.resetFields();
      loadFeeds();
    } catch (error) {
      console.error('Failed to save feed:', error);
      notification.error({
        message: 'Save Error',
        description: error.response?.data?.message || 'Failed to save RSS feed.'
      });
    }
  };

  const handleDelete = async (feedId) => {
    try {
      await feedsApi.deleteFeed(feedId);
      notification.success({
        message: 'Feed Deleted',
        description: 'RSS feed deleted successfully.'
      });
      loadFeeds();
    } catch (error) {
      console.error('Failed to delete feed:', error);
      notification.error({
        message: 'Delete Error',
        description: 'Failed to delete RSS feed.'
      });
    }
  };

  const handlePollFeed = async (feedId) => {
    setPollingFeed(feedId);
    try {
      await feedsApi.pollFeed(feedId);
      notification.success({
        message: 'Feed Polled',
        description: 'RSS feed polled successfully.'
      });
      loadFeeds();
    } catch (error) {
      console.error('Failed to poll feed:', error);
      notification.error({
        message: 'Poll Error',
        description: 'Failed to poll RSS feed.'
      });
    } finally {
      setPollingFeed(null);
    }
  };

  const handleImportMaharashtraFeeds = async () => {
    setImportLoading(true);
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const feed of MAHARASHTRA_FEEDS) {
        try {
          await feedsApi.addFeed({
            url: feed.url,
            name: feed.name,
            language: feed.language,
            refreshInterval: feed.refreshInterval,
            priority: feed.priority,
            keywords: feed.keywords,
            isActive: true,
            category: 'maharashtra-youtube',
            description: feed.description
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to import ${feed.name}:`, error);
          errorCount++;
        }
      }

      notification.success({
        message: 'Import Complete',
        description: `Successfully imported ${successCount} Maharashtra feeds. ${errorCount} failed.`,
        duration: 5
      });

      loadFeeds();
    } catch (error) {
      console.error('Import failed:', error);
      notification.error({
        message: 'Import Error',
        description: 'Failed to import Maharashtra feeds.'
      });
    } finally {
      setImportLoading(false);
    }
  };

  const openEditModal = (feed = null) => {
    setEditingFeed(feed);
    if (feed) {
      // Map backend fields to form fields
      const formValues = {
        name: feed.name,
        url: feed.url,
        description: feed.description,
        isActive: feed.isActive,
        refreshInterval: feed.refreshInterval,
        keywords: Array.isArray(feed.keywords) ? feed.keywords.join(', ') : '',
        language: feed.language,
        priority: feed.priority,
        category: feed.category
      };
      form.setFieldsValue(formValues);
    } else {
      form.resetFields();
    }
    setModalVisible(true);
  };

  const getStatusColor = (feed) => {
    if (!feed.isActive) return 'default';
    const lastPolled = moment(feed.lastPolled);
    const hoursSinceLastPoll = moment().diff(lastPolled, 'hours');
    
    if (hoursSinceLastPoll < 1) return 'success';
    if (hoursSinceLastPoll < 24) return 'warning';
    return 'error';
  };

  const getLanguageFlag = (language) => {
    switch (language) {
      case 'en': return '🇺🇸';
      case 'hi': return '🇮🇳';
      case 'mr': return '🏴󠁭󠁨󠁸󠁸󠁿';
      default: return '🌐';
    }
  };

  const columns = [
    {
      title: 'Feed Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <YoutubeOutlined style={{ color: '#ff4d4f' }} />
            <Text strong>{text}</Text>
            {record.category === 'maharashtra-youtube' && (
              <Tag size="small" color="orange">MH</Tag>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            {getLanguageFlag(record.language)} {record.language?.toUpperCase()} • 
            Priority: {record.priority || 'medium'}
          </div>
          {record.youtubeChannelUrl && (
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              <a 
                href={record.youtubeChannelUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: '#1890ff', textDecoration: 'none' }}
              >
                🔗 YouTube Channel
              </a>
            </div>
          )}
        </div>
      )
    },
    {
      title: 'YouTube Channel',
      key: 'channel',
      render: (_, record) => (
        <div>
          {record.youtubeChannelUrl ? (
            <div>
              <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                <Text code style={{ fontSize: '10px' }}>
                  {record.channel_id}
                </Text>
              </div>
              <a 
                href={record.youtubeChannelUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  color: '#1890ff', 
                  textDecoration: 'none',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <YoutubeOutlined />
                View Channel
              </a>
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              No channel info
            </Text>
          )}
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'status',
      render: (isActive, record) => (
        <div>
          <Badge 
            status={getStatusColor(record)} 
            text={isActive ? 'Active' : 'Inactive'} 
          />
          {record.lastPolled && (
            <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
              Last: {moment(record.lastPolled).fromNow()}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Refresh Interval',
      dataIndex: 'refreshInterval',
      key: 'refreshInterval',
      render: (interval) => (
        <Tag icon={<ClockCircleOutlined />} color="blue">
          {interval || 10}min
        </Tag>
      )
    },
    {
      title: 'Statistics & Videos',
      key: 'stats',
      render: (_, record) => (
        <div style={{ fontSize: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <div>Videos: <Text strong>{record.stats?.totalEntries || 0}</Text></div>
            <div>Mentions: <Text strong style={{ color: record.stats?.totalMentions > 0 ? '#52c41a' : undefined }}>
              {record.stats?.totalMentions || 0}
            </Text></div>
            <div>Errors: <Text strong style={{ color: record.stats?.errors > 0 ? '#ff4d4f' : undefined }}>
              {record.stats?.errors || 0}
            </Text></div>
          </div>
          {record.stats?.totalEntries > 0 && (
            <div style={{ fontSize: '10px', color: '#666' }}>
              <a 
                href="#" 
                style={{ color: '#1890ff', textDecoration: 'none' }}
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedFeedForVideos(record);
                  setVideoModalVisible(true);
                }}
              >
                📺 View Videos
              </a>
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Keywords',
      dataIndex: 'keywords',
      key: 'keywords',
      render: (keywords, record) => (
        <div style={{ maxWidth: '200px' }}>
          {keywords?.slice(0, 3).map((keyword, index) => (
            <Tooltip 
              key={index}
              title={
                <div>
                  <div style={{ marginBottom: '4px' }}>
                    <strong>Keyword:</strong> {keyword}
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    Click "📺 View Videos" to see specific YouTube videos where this keyword was mentioned
                  </div>
                </div>
              }
              placement="topLeft"
            >
              <Tag 
                size="small" 
                style={{ 
                  marginBottom: '2px',
                  cursor: 'help'
                }}
                color={record.stats?.totalMentions > 0 ? 'green' : 'default'}
              >
                {keyword}
              </Tag>
            </Tooltip>
          ))}
          {keywords?.length > 3 && (
            <Tooltip 
              title={`Total keywords: ${keywords.length}\n${keywords.slice(3).join(', ')}`}
            >
              <Tag size="small" color="default" style={{ cursor: 'help' }}>
                +{keywords.length - 3} more
              </Tag>
            </Tooltip>
          )}
          {keywords?.length > 0 && (
            <div style={{ fontSize: '10px', marginTop: '4px', color: '#666' }}>
              {record.stats?.totalMentions > 0 ? (
                <span style={{ color: '#52c41a' }}>✓ Mentions detected</span>
              ) : (
                <span>Monitoring for mentions...</span>
              )}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Poll Feed">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={pollingFeed === record._id}
              onClick={() => handlePollFeed(record._id)}
            />
          </Tooltip>
          <Tooltip title="Edit Feed">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Are you sure you want to delete this feed?"
            onConfirm={() => handleDelete(record._id)}
            okText="Yes"
            cancelText="No"
          >
            <Tooltip title="Delete Feed">
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const getActiveFeeds = () => Array.isArray(feeds) ? feeds.filter(f => f.isActive).length : 0;
  const getTotalEntries = () => Array.isArray(feeds) ? feeds.reduce((sum, f) => sum + (f.stats?.totalEntries || 0), 0) : 0;
  const getTotalMentions = () => Array.isArray(feeds) ? feeds.reduce((sum, f) => sum + (f.stats?.totalMentions || 0), 0) : 0;

  return (
    <div style={{ padding: '20px' }}>
      <Title level={2}>
        <YoutubeOutlined style={{ marginRight: '10px', color: '#ff4d4f' }} />
        RSS Feeds Manager
      </Title>

      {/* Statistics */}
      <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Total Feeds"
              value={feeds.length}
              prefix={<GlobalOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Active Feeds"
              value={getActiveFeeds()}
              prefix={<PlayCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Total Entries"
              value={getTotalEntries()}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card>
            <Statistic
              title="Total Mentions"
              value={getTotalMentions()}
              valueStyle={{ color: '#eb2f96' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Maharashtra Feeds Alert */}
      <Alert
        style={{ marginBottom: '20px' }}
        message="Maharashtra YouTube Channels"
        description={
          <div>
            <div style={{ marginBottom: '8px' }}>
              Import 9 pre-configured Maharashtra YouTube RSS feeds including Zee 24 Taas, ABP Majha, TV9 Marathi, and more.
            </div>
            <Button
              icon={<ImportOutlined />}
              loading={importLoading}
              onClick={handleImportMaharashtraFeeds}
              type="link"
              style={{ padding: 0 }}
            >
              Import Maharashtra Feeds
            </Button>
          </div>
        }
        type="info"
        showIcon
        closable
      />

      {/* Main Content */}
      <Card
        title="RSS Feeds"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadFeeds}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openEditModal()}
            >
              Add Feed
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={feeds}
          loading={loading}
          rowKey="_id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `Total ${total} feeds`
          }}
          scroll={{ x: 1400 }}
        />
      </Card>

      {/* Add/Edit Modal */}
      <Modal
        title={editingFeed ? 'Edit RSS Feed' : 'Add RSS Feed'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingFeed(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddEdit}
        >
          <Form.Item
            name="name"
            label="Feed Name"
            rules={[{ required: true, message: 'Please enter feed name' }]}
          >
            <Input placeholder="e.g., Zee 24 Taas" />
          </Form.Item>

          <Form.Item
            name="url"
            label="RSS URL"
            rules={[
              { required: true, message: 'Please enter RSS URL' },
              { type: 'url', message: 'Please enter a valid URL' }
            ]}
          >
            <Input placeholder="https://www.youtube.com/feeds/videos.xml?channel_id=..." />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="language"
                label="Language"
                rules={[{ required: true, message: 'Please select language' }]}
              >
                <Select placeholder="Select language">
                  <Option value="mr">🏴󠁭󠁨󠁸󠁸󠁿 Marathi</Option>
                  <Option value="hi">🇮🇳 Hindi</Option>
                  <Option value="en">🇺🇸 English</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="priority"
                label="Priority"
              >
                <Select placeholder="Select priority">
                  <Option value="high">High</Option>
                  <Option value="medium">Medium</Option>
                  <Option value="low">Low</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="refreshInterval"
                label="Refresh Interval (minutes)"
              >
                <Select placeholder="Select interval">
                  <Option value={2}>2 minutes</Option>
                  <Option value={5}>5 minutes</Option>
                  <Option value={10}>10 minutes</Option>
                  <Option value={30}>30 minutes</Option>
                  <Option value={60}>1 hour</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="category"
                label="Category"
              >
                <Input placeholder="e.g., maharashtra-youtube" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="keywords"
            label="Keywords (comma-separated)"
          >
            <Input placeholder="maharashtra, mumbai, pune, marathi" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea rows={2} placeholder="Brief description of the feed..." />
          </Form.Item>

          <Form.Item
            name="isActive"
            valuePropName="checked"
            label="Active"
          >
            <Switch />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingFeed ? 'Update Feed' : 'Add Feed'}
              </Button>
              <Button onClick={() => setModalVisible(false)}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Video List Modal */}
      <VideoListModal
        feedId={selectedFeedForVideos?._id}
        feedName={selectedFeedForVideos?.name}
        visible={videoModalVisible}
        onClose={() => {
          setVideoModalVisible(false);
          setSelectedFeedForVideos(null);
        }}
      />
    </div>
  );
};

export default RSSFeedsManager;