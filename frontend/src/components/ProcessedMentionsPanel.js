import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Checkbox,
  Tag,
  Tooltip,
  notification,
  Input,
  Select,
  DatePicker,
  Row,
  Col,
  Statistic,
  Typography,
  Badge,
  Rate,
  Progress,
  Popconfirm,
  Modal,
  Tabs,
  Slider
} from 'antd';
import {
  PlayCircleOutlined,
  YoutubeOutlined,
  CalendarOutlined,
  UserOutlined,
  EyeOutlined,
  CheckOutlined,
  CloseOutlined,
  SoundOutlined,
  HeartOutlined,
  FrownOutlined,
  MehOutlined,
  SmileOutlined,
  VideoCameraOutlined,
  SearchOutlined,
  FilterOutlined,
  ClearOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import { mentionsApi } from '../services/api';

const { Search } = Input;
const { Option } = Select;
const { RangePicker } = DatePicker;
const { Text, Paragraph } = Typography;
const { TabPane } = Tabs;

const ProcessedMentionsPanel = ({ 
  selectedMentions, 
  onMentionSelect, 
  onClipsGenerated 
}) => {
  const [loading, setLoading] = useState(false);
  const [mentions, setMentions] = useState([]);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });
  
  // Filter states
  const [filters, setFilters] = useState({
    search: '',
    sentiment: '',
    keyword: '',
    channel: '',
    confidence_min: 0,
    confidence_max: 1,
    verified_only: false,
    has_clips: '',
    dateRange: null,
    sortBy: 'timestamp',
    sortOrder: 'desc'
  });

  const [statistics, setStatistics] = useState({
    total_mentions: 0,
    avg_confidence: 0,
    verified_count: 0,
    clips_generated: 0,
    sentiment_breakdown: [],
    language_breakdown: []
  });

  const [detailModal, setDetailModal] = useState({
    visible: false,
    mention: null
  });

  useEffect(() => {
    loadProcessedMentions();
  }, [pagination.current, pagination.pageSize, filters]);

  const loadProcessedMentions = async () => {
    try {
      setLoading(true);
      
      const params = {
        page: pagination.current,
        limit: pagination.pageSize,
        sort_by: filters.sortBy,
        sort_order: filters.sortOrder,
        verified_only: filters.verified_only
      };

      // Add filters
      if (filters.search) params.keyword = filters.search;
      if (filters.sentiment) params.sentiment = filters.sentiment;
      if (filters.channel) params.channel_id = filters.channel;
      if (filters.confidence_min > 0) params.confidence_min = filters.confidence_min;
      if (filters.confidence_max < 1) params.confidence_max = filters.confidence_max;
      if (filters.has_clips !== '') params.has_clips = filters.has_clips === 'true';
      if (filters.dateRange && filters.dateRange.length === 2) {
        params.date_from = filters.dateRange[0].toISOString();
        params.date_to = filters.dateRange[1].toISOString();
      }

      const response = await mentionsApi.getProcessedMentions(params);
      
      if (response.data.success) {
        setMentions(response.data.data.mentions);
        setPagination(prev => ({
          ...prev,
          total: response.data.data.pagination.total
        }));
        setStatistics(response.data.data.statistics);
      }

    } catch (error) {
      console.error('Error loading processed mentions:', error);
      notification.error({
        message: 'Error Loading Mentions',
        description: 'Failed to load processed mentions. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value) => {
    setFilters(prev => ({ ...prev, search: value }));
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      sentiment: '',
      keyword: '',
      channel: '',
      confidence_min: 0,
      confidence_max: 1,
      verified_only: false,
      has_clips: '',
      dateRange: null,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    });
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleSelectAll = (checked) => {
    const mentionIds = checked 
      ? mentions.map(m => m._id)
      : [];
    onMentionSelect(mentionIds, 'set');
  };

  const handleSelectMention = (mentionId, checked) => {
    onMentionSelect([mentionId], checked ? 'add' : 'remove');
  };

  const handleVerifyMentions = async (mentionIds, verificationStatus) => {
    try {
      const response = await mentionsApi.verifyMentions({
        mention_ids: mentionIds,
        verification_status: verificationStatus,
        verified_by: 'user',
        notes: `Manually ${verificationStatus} by user`
      });

      if (response.data.success) {
        notification.success({
          message: 'Verification Complete',
          description: `${mentionIds.length} mentions ${verificationStatus}.`
        });
        loadProcessedMentions();
        onMentionSelect([], 'clear');
      }

    } catch (error) {
      notification.error({
        message: 'Verification Failed',
        description: error.response?.data?.message || 'Failed to verify mentions.'
      });
    }
  };

  const handleCreateClips = async (mentionIds) => {
    try {
      const response = await mentionsApi.bulkAction({
        action: 'create_clips',
        mention_ids: mentionIds,
        action_by: 'user',
        clip_settings: {
          format: 'mp4',
          quality: '720p',
          context_padding: 20,
          include_subtitles: false,
          watermark: false
        }
      });

      if (response.data.success) {
        notification.success({
          message: 'Clips Creation Started',
          description: `${response.data.data.results.clips_created} clips are being generated.`,
          duration: 5
        });
        loadProcessedMentions();
        onMentionSelect([], 'clear');
        onClipsGenerated();
      }

    } catch (error) {
      notification.error({
        message: 'Clip Creation Failed',
        description: error.response?.data?.message || 'Failed to create clips.'
      });
    }
  };

  const getSentimentIcon = (sentiment) => {
    const icons = {
      positive: <SmileOutlined style={{ color: '#52c41a' }} />,
      negative: <FrownOutlined style={{ color: '#f5222d' }} />,
      neutral: <MehOutlined style={{ color: '#1890ff' }} />
    };
    return icons[sentiment] || <MehOutlined />;
  };

  const getSentimentColor = (sentiment) => {
    const colors = {
      positive: 'success',
      negative: 'error',
      neutral: 'processing'
    };
    return colors[sentiment] || 'default';
  };

  const formatConfidence = (confidence) => {
    return `${Math.round(confidence * 100)}%`;
  };

  const showMentionDetail = (mention) => {
    setDetailModal({
      visible: true,
      mention: mention
    });
  };

  const columns = [
    {
      title: (
        <Checkbox
          checked={selectedMentions.length > 0 && selectedMentions.length === mentions.length}
          indeterminate={selectedMentions.length > 0 && selectedMentions.length < mentions.length}
          onChange={(e) => handleSelectAll(e.target.checked)}
        >
          Select
        </Checkbox>
      ),
      width: 80,
      render: (_, record) => (
        <Checkbox
          checked={selectedMentions.includes(record._id)}
          onChange={(e) => handleSelectMention(record._id, e.target.checked)}
        />
      )
    },
    {
      title: 'Mention Details',
      key: 'details',
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img
            src={record.youtube_clip_url ? `https://img.youtube.com/vi/${record.video_metadata.video_id}/default.jpg` : '/placeholder-video.png'}
            alt="thumbnail"
            style={{ width: 60, height: 45, borderRadius: '4px', objectFit: 'cover' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              <Tooltip title={record.detected_keyword}>
                <Tag color="blue">{record.detected_keyword}</Tag>
              </Tooltip>
              <Text ellipsis style={{ maxWidth: '200px' }}>
                {record.video_metadata.video_title}
              </Text>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>
              <Space size="small">
                <UserOutlined />
                {record.video_metadata.channel_name}
                <CalendarOutlined />
                {new Date(record.timestamp).toLocaleDateString()}
              </Space>
            </div>
            <div style={{ fontSize: '11px', color: '#999' }}>
              <Text ellipsis style={{ maxWidth: '300px' }}>
                "{record.mention_text}"
              </Text>
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence_score',
      width: 100,
      render: (confidence) => (
        <div>
          <Progress
            type="circle"
            size="small"
            percent={Math.round(confidence * 100)}
            format={() => formatConfidence(confidence)}
          />
        </div>
      ),
      sorter: true
    },
    {
      title: 'Sentiment',
      key: 'sentiment',
      width: 120,
      render: (_, record) => (
        <Tag 
          color={getSentimentColor(record.sentiment?.overall)}
          icon={getSentimentIcon(record.sentiment?.overall)}
        >
          {record.sentiment?.overall?.toUpperCase() || 'UNKNOWN'}
        </Tag>
      )
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_, record) => (
        <Space direction="vertical" size="small">
          {record.user_verified && (
            <Tag color="green" icon={<CheckOutlined />}>
              VERIFIED
            </Tag>
          )}
          {record.clip_generated && (
            <Tag color="orange" icon={<VideoCameraOutlined />}>
              HAS CLIP
            </Tag>
          )}
          {record.false_positive && (
            <Tag color="red" icon={<CloseOutlined />}>
              FALSE POSITIVE
            </Tag>
          )}
        </Space>
      )
    },
    {
      title: 'Language',
      dataIndex: 'language',
      width: 80,
      render: (language) => (
        <Tag>{language?.toUpperCase()}</Tag>
      )
    },
    {
      title: 'Actions',
      width: 180,
      render: (_, record) => (
        <Space>
          <Tooltip title="View Details">
            <Button
              size="small"
              icon={<InfoCircleOutlined />}
              onClick={() => showMentionDetail(record)}
            />
          </Tooltip>
          
          <Tooltip title="Watch on YouTube">
            <Button
              size="small"
              icon={<YoutubeOutlined />}
              onClick={() => window.open(record.youtube_clip_url, '_blank')}
            />
          </Tooltip>

          {!record.user_verified && (
            <>
              <Tooltip title="Approve">
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => handleVerifyMentions([record._id], 'approved')}
                />
              </Tooltip>
              <Tooltip title="Reject">
                <Button
                  size="small"
                  icon={<CloseOutlined />}
                  danger
                  onClick={() => handleVerifyMentions([record._id], 'rejected')}
                />
              </Tooltip>
            </>
          )}

          {record.user_verified && !record.clip_generated && (
            <Tooltip title="Create Clip">
              <Button
                size="small"
                type="primary"
                icon={<VideoCameraOutlined />}
                onClick={() => handleCreateClips([record._id])}
              />
            </Tooltip>
          )}
        </Space>
      )
    }
  ];

  const renderFilters = () => (
    <Card style={{ marginBottom: '16px' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={6}>
          <Search
            placeholder="Search mentions..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            onSearch={handleSearch}
            allowClear
          />
        </Col>
        <Col xs={24} sm={4}>
          <Select
            placeholder="Sentiment"
            value={filters.sentiment}
            onChange={(value) => handleFilterChange('sentiment', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="positive">Positive</Option>
            <Option value="negative">Negative</Option>
            <Option value="neutral">Neutral</Option>
          </Select>
        </Col>
        <Col xs={24} sm={4}>
          <Select
            placeholder="Clips"
            value={filters.has_clips}
            onChange={(value) => handleFilterChange('has_clips', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="true">Has Clips</Option>
            <Option value="false">No Clips</Option>
          </Select>
        </Col>
        <Col xs={24} sm={6}>
          <div>
            <Text style={{ fontSize: '12px' }}>Confidence: {Math.round(filters.confidence_min * 100)}% - {Math.round(filters.confidence_max * 100)}%</Text>
            <Slider
              range
              min={0}
              max={1}
              step={0.1}
              value={[filters.confidence_min, filters.confidence_max]}
              onChange={(values) => {
                handleFilterChange('confidence_min', values[0]);
                handleFilterChange('confidence_max', values[1]);
              }}
            />
          </div>
        </Col>
        <Col xs={24} sm={4}>
          <Space>
            <Button
              icon={<ClearOutlined />}
              onClick={clearFilters}
            >
              Clear
            </Button>
          </Space>
        </Col>
      </Row>
    </Card>
  );

  const renderStatistics = () => (
    <Row gutter={[16, 16]} style={{ marginBottom: '16px' }}>
      <Col span={6}>
        <Card>
          <Statistic
            title="Total Mentions"
            value={statistics.total_mentions}
            prefix={<SoundOutlined />}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="Avg Confidence"
            value={Math.round(statistics.avg_confidence * 100)}
            suffix="%"
            valueStyle={{ color: '#1890ff' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="Verified"
            value={statistics.verified_count}
            valueStyle={{ color: '#52c41a' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="Clips Generated"
            value={statistics.clips_generated}
            valueStyle={{ color: '#fa8c16' }}
            prefix={<VideoCameraOutlined />}
          />
        </Card>
      </Col>
    </Row>
  );

  const renderBatchActions = () => (
    <div style={{ marginBottom: '16px' }}>
      <Space>
        <Badge count={selectedMentions.length}>
          <Button
            type="primary"
            disabled={selectedMentions.length === 0}
            onClick={() => handleCreateClips(selectedMentions)}
          >
            Create Clips
          </Button>
        </Badge>
        <Button
          disabled={selectedMentions.length === 0}
          onClick={() => handleVerifyMentions(selectedMentions, 'approved')}
        >
          Approve Selected
        </Button>
        <Button
          disabled={selectedMentions.length === 0}
          onClick={() => handleVerifyMentions(selectedMentions, 'rejected')}
          danger
        >
          Reject Selected
        </Button>
        <Button
          disabled={selectedMentions.length === 0}
          onClick={() => onMentionSelect([], 'clear')}
        >
          Clear Selection
        </Button>
      </Space>
    </div>
  );

  const renderMentionDetailModal = () => (
    <Modal
      title="Mention Details"
      open={detailModal.visible}
      onCancel={() => setDetailModal({ visible: false, mention: null })}
      width={800}
      footer={[
        <Button key="close" onClick={() => setDetailModal({ visible: false, mention: null })}>
          Close
        </Button>,
        <Button 
          key="youtube" 
          icon={<YoutubeOutlined />}
          onClick={() => window.open(detailModal.mention?.youtube_clip_url, '_blank')}
        >
          Watch on YouTube
        </Button>
      ]}
    >
      {detailModal.mention && (
        <Tabs defaultActiveKey="1">
          <TabPane tab="Basic Info" key="1">
            <Row gutter={16}>
              <Col span={12}>
                <p><strong>Detected Keyword:</strong> {detailModal.mention.detected_keyword}</p>
                <p><strong>Confidence Score:</strong> {formatConfidence(detailModal.mention.confidence_score)}</p>
                <p><strong>Sentiment:</strong> {detailModal.mention.sentiment?.overall}</p>
                <p><strong>Language:</strong> {detailModal.mention.language}</p>
                <p><strong>Timestamp:</strong> {new Date(detailModal.mention.timestamp).toLocaleString()}</p>
              </Col>
              <Col span={12}>
                <p><strong>Channel:</strong> {detailModal.mention.video_metadata.channel_name}</p>
                <p><strong>Video Title:</strong> {detailModal.mention.video_metadata.video_title}</p>
                <p><strong>Published:</strong> {new Date(detailModal.mention.video_metadata.published_at).toLocaleDateString()}</p>
                <p><strong>User Verified:</strong> {detailModal.mention.user_verified ? 'Yes' : 'No'}</p>
                <p><strong>Clip Generated:</strong> {detailModal.mention.clip_generated ? 'Yes' : 'No'}</p>
              </Col>
            </Row>
          </TabPane>
          <TabPane tab="Mention Text" key="2">
            <Paragraph>
              <strong>Mention Context:</strong>
            </Paragraph>
            <Paragraph
              style={{ 
                background: '#f5f5f5', 
                padding: '12px', 
                borderRadius: '6px',
                fontFamily: 'monospace'
              }}
            >
              {detailModal.mention.mention_text}
            </Paragraph>
          </TabPane>
          <TabPane tab="Transcript Segment" key="3">
            <Paragraph>
              <strong>Full Transcript Segment:</strong>
            </Paragraph>
            <Paragraph
              style={{ 
                background: '#f5f5f5', 
                padding: '12px', 
                borderRadius: '6px',
                maxHeight: '300px',
                overflow: 'auto'
              }}
            >
              {detailModal.mention.transcript_segment?.text}
            </Paragraph>
          </TabPane>
        </Tabs>
      )}
    </Modal>
  );

  return (
    <div>
      {renderStatistics()}
      {renderFilters()}
      {renderBatchActions()}
      
      <Card>
        <Table
          columns={columns}
          dataSource={mentions}
          rowKey="_id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} of ${total} mentions`,
            onChange: (page, pageSize) => {
              setPagination(prev => ({
                ...prev,
                current: page,
                pageSize: pageSize
              }));
            }
          }}
          scroll={{ x: 1400 }}
          size="small"
        />
      </Card>

      {renderMentionDetailModal()}
    </div>
  );
};

export default ProcessedMentionsPanel;