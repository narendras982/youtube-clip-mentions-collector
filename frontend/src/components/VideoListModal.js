import React, { useState, useEffect } from 'react';
import {
  Modal,
  Table,
  Tag,
  Typography,
  Space,
  Avatar,
  Tooltip,
  Button,
  Spin,
  Empty,
  Alert,
  Row,
  Col,
  Statistic,
  Badge,
  Card
} from 'antd';
import {
  PlayCircleOutlined,
  YoutubeOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  TagOutlined,
  HeartOutlined,
  FrownOutlined,
  MehOutlined,
  LinkOutlined
} from '@ant-design/icons';
import moment from 'moment';
import { feedsApi } from '../services/api';

const { Title, Text, Link } = Typography;

const VideoListModal = ({ feedId, feedName, visible, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState([]);
  const [pagination, setPagination] = useState({ 
    page: 1, 
    limit: 10, 
    total: 0, 
    pages: 0 
  });
  const [feedData, setFeedData] = useState(null);

  useEffect(() => {
    if (visible && feedId) {
      loadVideos();
    }
  }, [visible, feedId]);

  const loadVideos = async (page = 1) => {
    setLoading(true);
    try {
      const response = await feedsApi.getFeedVideos(feedId, page, 10);
      
      if (response.data.success) {
        setVideos(response.data.data.videos || []);
        setPagination(response.data.data.pagination || { page: 1, limit: 10, total: 0, pages: 0 });
        setFeedData(response.data.data.feed || null);
      } else {
        setVideos([]);
      }
    } catch (error) {
      console.error('Failed to load videos:', error);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTableChange = (paginationInfo) => {
    loadVideos(paginationInfo.current);
  };

  const getSentimentIcon = (sentiments) => {
    if (!sentiments || sentiments.length === 0) return <MehOutlined style={{ color: '#999' }} />;
    
    if (sentiments.includes('positive')) return <HeartOutlined style={{ color: '#52c41a' }} />;
    if (sentiments.includes('negative')) return <FrownOutlined style={{ color: '#ff4d4f' }} />;
    return <MehOutlined style={{ color: '#faad14' }} />;
  };

  const getSentimentColor = (sentiments) => {
    if (!sentiments || sentiments.length === 0) return 'default';
    
    if (sentiments.includes('positive')) return 'green';
    if (sentiments.includes('negative')) return 'red';
    return 'orange';
  };

  const formatViewCount = (count) => {
    if (!count) return '0';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const columns = [
    {
      title: 'Video',
      key: 'video',
      width: 300,
      render: (_, record) => (
        <div style={{ display: 'flex', gap: '12px' }}>
          <Avatar
            size={64}
            shape="square"
            src={record.thumbnail_url}
            icon={<PlayCircleOutlined />}
            style={{ flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tooltip title={record.title}>
              <Text strong style={{ 
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: '4px',
                fontSize: '13px'
              }}>
                {record.title}
              </Text>
            </Tooltip>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
              {record.channel_name}
            </div>
            <div style={{ fontSize: '10px', color: '#999' }}>
              <ClockCircleOutlined style={{ marginRight: '4px' }} />
              {moment(record.published_at).fromNow()}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Mentions',
      key: 'mentions',
      width: 150,
      render: (_, record) => (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '8px' }}>
            <Badge 
              count={record.total_mentions} 
              style={{ backgroundColor: record.total_mentions > 0 ? '#52c41a' : '#d9d9d9' }}
            />
          </div>
          {record.keywords_detected && record.keywords_detected.length > 0 && (
            <div>
              {record.keywords_detected.slice(0, 2).map((keyword, index) => (
                <Tag key={index} size="small" style={{ margin: '1px', fontSize: '10px' }}>
                  {keyword}
                </Tag>
              ))}
              {record.keywords_detected.length > 2 && (
                <Tag size="small" style={{ margin: '1px', fontSize: '10px' }}>
                  +{record.keywords_detected.length - 2}
                </Tag>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Sentiment',
      key: 'sentiment',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '4px' }}>
            {getSentimentIcon(record.sentiments)}
          </div>
          {record.sentiments && record.sentiments.length > 0 && (
            <Tag size="small" color={getSentimentColor(record.sentiments)}>
              {record.sentiments[0]}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Stats',
      key: 'stats',
      width: 120,
      render: (_, record) => (
        <div style={{ fontSize: '11px' }}>
          <div style={{ marginBottom: '4px' }}>
            <EyeOutlined style={{ marginRight: '4px', color: '#666' }} />
            {formatViewCount(record.view_count)} views
          </div>
          <div style={{ color: '#666' }}>
            Published: {moment(record.published_at).format('MMM D')}
          </div>
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <div style={{ textAlign: 'center' }}>
          <Tooltip title="Watch on YouTube">
            <Button
              type="primary"
              size="small"
              icon={<YoutubeOutlined />}
              href={record.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ backgroundColor: '#ff4d4f', borderColor: '#ff4d4f' }}
            >
              Watch
            </Button>
          </Tooltip>
          {record.total_mentions > 0 && (
            <div style={{ marginTop: '4px' }}>
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                style={{ padding: 0, fontSize: '10px' }}
              >
                View Clips
              </Button>
            </div>
          )}
        </div>
      ),
    },
  ];

  const modalTitle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <YoutubeOutlined style={{ color: '#ff4d4f' }} />
      <span>Videos from {feedName}</span>
      {feedData && (
        <Tag color="blue" style={{ marginLeft: '8px' }}>
          {feedData.channel_name}
        </Tag>
      )}
    </div>
  );

  return (
    <Modal
      title={modalTitle}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={1000}
      destroyOnClose={true}
      styles={{
        body: { padding: '20px' }
      }}
    >
      <div>
        {/* Statistics Row */}
        <Row gutter={16} style={{ marginBottom: '20px' }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Total Videos"
                value={pagination.total}
                prefix={<PlayCircleOutlined />}
                valueStyle={{ fontSize: '16px' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="With Mentions"
                value={videos.filter(v => v.total_mentions > 0).length}
                prefix={<TagOutlined />}
                valueStyle={{ fontSize: '16px', color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Total Mentions"
                value={videos.reduce((sum, v) => sum + (v.total_mentions || 0), 0)}
                prefix={<TagOutlined />}
                valueStyle={{ fontSize: '16px', color: '#fa8c16' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="Current Page"
                value={`${pagination.page} / ${pagination.pages}`}
                valueStyle={{ fontSize: '16px' }}
              />
            </Card>
          </Col>
        </Row>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin size="large" />
            <div style={{ marginTop: '16px' }}>Loading videos...</div>
          </div>
        ) : videos.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div>No videos found with mentions for this feed</div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                  Videos will appear here once the RSS feed is processed and mentions are detected
                </div>
              </div>
            }
          />
        ) : (
          <>
            <Alert
              style={{ marginBottom: '16px' }}
              message="Video List"
              description={`Showing ${videos.length} videos from ${feedName}. These are videos where keyword mentions have been detected.`}
              type="info"
              showIcon
              closable
            />
            
            <Table
              columns={columns}
              dataSource={videos}
              rowKey="video_id"
              pagination={{
                current: pagination.page,
                pageSize: pagination.limit,
                total: pagination.total,
                showSizeChanger: false,
                showQuickJumper: true,
                showTotal: (total, range) => 
                  `${range[0]}-${range[1]} of ${total} videos`,
              }}
              onChange={handleTableChange}
              size="small"
              scroll={{ x: 800 }}
            />
          </>
        )}
      </div>
    </Modal>
  );
};

export default VideoListModal;