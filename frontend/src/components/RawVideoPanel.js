import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Checkbox,
  Tag,
  Avatar,
  Tooltip,
  notification,
  Input,
  Select,
  DatePicker,
  Row,
  Col,
  Statistic,
  Progress,
  Typography,
  Popconfirm,
  Badge
} from 'antd';
import {
  PlayCircleOutlined,
  YoutubeOutlined,
  CalendarOutlined,
  UserOutlined,
  EyeOutlined,
  LoadingOutlined,
  SearchOutlined,
  FilterOutlined,
  ClearOutlined,
  CheckOutlined,
  CloseOutlined
} from '@ant-design/icons';
import { rawVideosApi } from '../services/api';

const { Search } = Input;
const { Option } = Select;
const { RangePicker } = DatePicker;
const { Text } = Typography;

const RawVideoPanel = ({ 
  selectedVideos, 
  onVideoSelect, 
  processingStatus, 
  onProcessingComplete,
  onVideosMarkedAsSelected
}) => {
  const [loading, setLoading] = useState(false);
  const [rawVideos, setRawVideos] = useState([]);
  const [localProcessingStatus, setLocalProcessingStatus] = useState({});
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });
  
  // Filter states
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    channel: '',
    dateRange: null,
    sortBy: 'published_at',
    sortOrder: 'desc',
    transcriptStatus: '', // Don't filter by transcript status initially
    hasTranscript: null // Show all videos initially
  });

  const [statistics, setStatistics] = useState({
    total: 0,
    pending: 0,
    selected: 0,
    processing: 0,
    processed: 0,
    skipped: 0
  });

  useEffect(() => {
    loadRawVideos();
  }, [pagination.current, pagination.pageSize, filters]);

  const loadRawVideos = async () => {
    try {
      setLoading(true);
      
      const params = {
        page: pagination.current,
        limit: pagination.pageSize,
        sort_by: filters.sortBy,
        sort_order: filters.sortOrder
      };

      // Add filters
      if (filters.search) {
        params.search = filters.search;
      }
      if (filters.status) {
        params.status = filters.status;
      }
      if (filters.channel) {
        params.channel_id = filters.channel;
      }
      if (filters.dateRange && filters.dateRange.length === 2) {
        params.date_from = filters.dateRange[0].toISOString();
        params.date_to = filters.dateRange[1].toISOString();
      }
      // Transcript availability filters
      if (filters.transcriptStatus) {
        params.transcript_status = filters.transcriptStatus;
      }
      if (filters.hasTranscript !== null) {
        params.has_transcript = filters.hasTranscript;
      }

      const response = await rawVideosApi.getRawVideos(params);
      
      if (response.data.success) {
        setRawVideos(response.data.data.videos);
        setPagination(prev => ({
          ...prev,
          total: response.data.data.pagination.total
        }));
        setStatistics(response.data.data.statistics);
      }

    } catch (error) {
      console.error('Error loading raw videos:', error);
      notification.error({
        message: 'Error Loading Videos',
        description: 'Failed to load raw videos. Please try again.'
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
      status: '',
      channel: '',
      dateRange: null,
      sortBy: 'published_at',
      sortOrder: 'desc',
      transcriptStatus: '', // Don't filter by transcript status initially
      hasTranscript: null // Show all videos initially
    });
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  const handleSelectAll = (checked) => {
    const videoIds = checked 
      ? rawVideos.filter(v => v.raw_status === 'pending').map(v => v.video_id)
      : [];
    onVideoSelect(videoIds, 'set');
  };

  const handleSelectVideo = (videoId, checked) => {
    // Find the video record and get the video_id (YouTube ID)
    const video = rawVideos.find(v => v._id === videoId);
    const youtubeVideoId = video ? video.video_id : videoId;
    onVideoSelect([youtubeVideoId], checked ? 'add' : 'remove');
  };

  const handleMarkAsSelected = async (videoIds) => {
    try {
      const response = await rawVideosApi.selectVideos({
        video_ids: videoIds,
        selected_by: 'user',
        selection_reason: 'manual_selection'
      });

      if (response.data.success) {
        notification.success({
          message: 'Videos Selected',
          description: `${videoIds.length} videos marked as selected for processing.`
        });
        loadRawVideos();
        
        // Call parent callback to sync selected videos state
        if (onVideosMarkedAsSelected) {
          onVideosMarkedAsSelected(videoIds);
        }
      }

    } catch (error) {
      notification.error({
        message: 'Selection Failed',
        description: error.response?.data?.message || 'Failed to mark videos as selected.'
      });
    }
  };

  const handleSkipVideo = async (videoId) => {
    try {
      const response = await rawVideosApi.skipVideo(videoId, {
        skipped_by: 'user',
        skip_reason: 'not_relevant'
      });

      if (response.data.success) {
        notification.success({
          message: 'Video Skipped',
          description: 'Video marked as skipped and will not be processed.'
        });
        loadRawVideos();
      }

    } catch (error) {
      notification.error({
        message: 'Skip Failed',
        description: 'Failed to skip video.'
      });
    }
  };

  const handleProcessSelectedVideos = async () => {
    try {
      setLocalProcessingStatus({ status: 'processing', count: selectedVideos.length });

      // REAL PROCESSING ONLY - No mock processing fallback
      const response = await rawVideosApi.processVideos({
        video_ids: selectedVideos,
        processing_options: {
          use_fuzzy_matching: true,
          fuzzy_threshold: 0.8,
          enable_sentiment: true,
          languages: ['mr', 'hi', 'en'],
          real_processing_only: true, // Force real processing
          disable_mock_fallback: true // Explicitly disable mock processing
        }
      });

      if (response.data.success) {
        notification.success({
          message: 'Processing Started',
          description: `${response.data.data.total_queued} videos queued for real transcript-based processing.`,
          duration: 5
        });

        // Clear selection and refresh videos
        onVideoSelect([], 'clear');
        setTimeout(() => {
          loadRawVideos();
          setLocalProcessingStatus({});
        }, 2000);
      }

    } catch (error) {
      console.error('Error processing videos:', error);
      notification.error({
        message: 'Processing Failed',
        description: error.response?.data?.message || 'Failed to start video processing.'
      });
      setLocalProcessingStatus({});
    }
  };

  const handleProcessReadyVideos = async () => {
    try {
      // Get all videos that are marked as 'selected' 
      const response = await rawVideosApi.getRawVideos({ status: 'selected', limit: 100 });
      const readyVideos = response.data.data.videos;
      
      if (readyVideos.length === 0) {
        notification.warning({
          message: 'No Ready Videos',
          description: 'No videos are currently marked as ready for processing.'
        });
        return;
      }

      const videoIds = readyVideos.map(v => v.video_id);
      setLocalProcessingStatus({ status: 'processing', count: videoIds.length });

      const processResponse = await rawVideosApi.processVideos({
        video_ids: videoIds,
        processing_options: {
          use_fuzzy_matching: true,
          fuzzy_threshold: 0.8,
          enable_sentiment: true,
          languages: ['mr', 'hi', 'en'],
          real_processing_only: true, // Force real processing
          disable_mock_fallback: true // Explicitly disable mock processing
        }
      });

      if (processResponse.data.success) {
        notification.success({
          message: 'Processing Started',
          description: `${processResponse.data.data.total_queued} ready videos queued for processing.`,
          duration: 5
        });

        setTimeout(() => {
          loadRawVideos();
          setLocalProcessingStatus({});
        }, 2000);
      }

    } catch (error) {
      console.error('Error processing ready videos:', error);
      notification.error({
        message: 'Processing Failed',
        description: error.response?.data?.message || 'Failed to start processing ready videos.'
      });
      setLocalProcessingStatus({});
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'blue',
      selected: 'orange',
      processing: 'cyan',
      processed: 'green',
      skipped: 'red'
    };
    return colors[status] || 'default';
  };

  const getStatusIcon = (status) => {
    const icons = {
      pending: <EyeOutlined />,
      selected: <CheckOutlined />,
      processing: <LoadingOutlined spin />,
      processed: <PlayCircleOutlined />,
      skipped: <CloseOutlined />
    };
    return icons[status];
  };

  const getTranscriptStatusColor = (status) => {
    const colors = {
      unknown: 'default',
      checking: 'processing',
      available: 'success',
      unavailable: 'error',
      error: 'warning'
    };
    return colors[status] || 'default';
  };

  const getTranscriptStatusIcon = (status) => {
    const icons = {
      unknown: <EyeOutlined />,
      checking: <LoadingOutlined spin />,
      available: <CheckOutlined />,
      unavailable: <CloseOutlined />,
      error: <CloseOutlined />
    };
    return icons[status] || <EyeOutlined />;
  };

  const columns = [
    {
      title: (
        <Checkbox
          checked={selectedVideos.length > 0 && selectedVideos.length === rawVideos.filter(v => v.raw_status === 'pending').length}
          indeterminate={selectedVideos.length > 0 && selectedVideos.length < rawVideos.filter(v => v.raw_status === 'pending').length}
          onChange={(e) => handleSelectAll(e.target.checked)}
        >
          Select
        </Checkbox>
      ),
      width: 80,
      render: (_, record) => (
        <Checkbox
          checked={selectedVideos.includes(record.video_id)}
          disabled={record.raw_status !== 'pending'}
          onChange={(e) => handleSelectVideo(record._id, e.target.checked)}
        />
      )
    },
    {
      title: 'Video Details',
      key: 'details',
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img
            src={record.thumbnail_url || `https://img.youtube.com/vi/${record.video_id}/default.jpg`}
            alt="thumbnail"
            style={{ width: 60, height: 45, borderRadius: '4px', objectFit: 'cover' }}
            onError={(e) => {
              e.target.src = `https://img.youtube.com/vi/${record.video_id}/default.jpg`;
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              <Tooltip title={record.title}>
                <Text ellipsis style={{ maxWidth: '300px', display: 'block' }}>
                  {record.title}
                </Text>
              </Tooltip>
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              <Space size="small">
                <UserOutlined />
                {record.channel_name}
              </Space>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
              <Space size="small">
                <CalendarOutlined />
                {new Date(record.published_at).toLocaleDateString()}
                {record.duration && (
                  <>
                    • Duration: {Math.floor(record.duration / 60)}:{(record.duration % 60).toString().padStart(2, '0')}
                  </>
                )}
              </Space>
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'raw_status',
      width: 120,
      render: (status) => (
        <Tag color={getStatusColor(status)} icon={getStatusIcon(status)}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Transcript',
      key: 'content_type',
      width: 130,
      render: (_, record) => (
        <Space direction="vertical" size="small">
          {record.is_youtube_short ? (
            <Tag color="purple">
              <PlayCircleOutlined />
              SHORT
            </Tag>
          ) : (
            <Tag color={getTranscriptStatusColor(record.transcript_status)}>
              {getTranscriptStatusIcon(record.transcript_status)}
              {(record.transcript_status || 'UNKNOWN').toUpperCase()}
            </Tag>
          )}
          {record.is_youtube_short ? (
            <Text type="secondary" style={{ fontSize: '11px' }}>
              KEYWORD BASED
            </Text>
          ) : (
            record.transcript_language && (
              <Text type="secondary" style={{ fontSize: '11px' }}>
                {record.transcript_language.toUpperCase()}
              </Text>
            )
          )}
        </Space>
      )
    },
    {
      title: 'Feed Source',
      dataIndex: ['feed_id', 'name'],
      width: 150,
      render: (feedName) => (
        <Text type="secondary">{feedName || 'Unknown'}</Text>
      )
    },
    {
      title: 'Actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Tooltip title="Watch on YouTube">
            <Button
              size="small"
              icon={<YoutubeOutlined />}
              onClick={() => {
                const youtubeUrl = record.video_url || `https://www.youtube.com/watch?v=${record.video_id}`;
                window.open(youtubeUrl, '_blank');
              }}
            />
          </Tooltip>
          
          {record.raw_status === 'pending' && (
            <Tooltip title="Mark as Selected">
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleMarkAsSelected([record.video_id])}
              />
            </Tooltip>
          )}
          
          {record.raw_status === 'pending' && (
            <Popconfirm
              title="Skip this video?"
              description="This video will not be processed for mentions."
              onConfirm={() => handleSkipVideo(record._id)}
              okText="Skip"
              cancelText="Cancel"
            >
              <Tooltip title="Skip Video">
                <Button
                  size="small"
                  icon={<CloseOutlined />}
                  danger
                />
              </Tooltip>
            </Popconfirm>
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
            placeholder="Search videos..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            onSearch={handleSearch}
            allowClear
          />
        </Col>
        <Col xs={24} sm={4}>
          <Select
            placeholder="Status"
            value={filters.status}
            onChange={(value) => handleFilterChange('status', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="pending">Pending</Option>
            <Option value="selected">Selected</Option>
            <Option value="processing">Processing</Option>
            <Option value="processed">Processed</Option>
            <Option value="skipped">Skipped</Option>
          </Select>
        </Col>
        <Col xs={24} sm={6}>
          <RangePicker
            value={filters.dateRange}
            onChange={(dates) => handleFilterChange('dateRange', dates)}
            style={{ width: '100%' }}
          />
        </Col>
        <Col xs={24} sm={4}>
          <Select
            placeholder="Sort By"
            value={filters.sortBy}
            onChange={(value) => handleFilterChange('sortBy', value)}
            style={{ width: '100%' }}
          >
            <Option value="published_at">Published Date</Option>
            <Option value="addedAt">Added Date</Option>
            <Option value="title">Title</Option>
            <Option value="duration">Duration</Option>
          </Select>
        </Col>
        <Col xs={24} sm={4}>
          <Select
            placeholder="Transcript Status"
            value={filters.transcriptStatus}
            onChange={(value) => handleFilterChange('transcriptStatus', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value="available">Has Transcript</Option>
            <Option value="unavailable">No Transcript</Option>
            <Option value="checking">Checking</Option>
            <Option value="unknown">Unknown</Option>
            <Option value="error">Check Failed</Option>
          </Select>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: '8px' }}>
        <Col xs={24} sm={4}>
          <Select
            placeholder="Show Videos With..."
            value={filters.hasTranscript}
            onChange={(value) => handleFilterChange('hasTranscript', value)}
            allowClear
            style={{ width: '100%' }}
          >
            <Option value={true}>With Transcripts & Shorts</Option>
            <Option value={false}>Only Without Transcripts</Option>
          </Select>
        </Col>
        <Col xs={24} sm={4}>
          <Space>
            <Button
              icon={<ClearOutlined />}
              onClick={clearFilters}
            >
              Clear Filters
            </Button>
          </Space>
        </Col>
      </Row>
    </Card>
  );

  const renderStatistics = () => (
    <Row gutter={[16, 16]} style={{ marginBottom: '16px' }}>
      <Col span={4}>
        <Card>
          <Statistic
            title="Total Videos"
            value={statistics.total}
            prefix={<YoutubeOutlined />}
          />
        </Card>
      </Col>
      <Col span={4}>
        <Card>
          <Statistic
            title="Pending"
            value={statistics.pending}
            valueStyle={{ color: '#1890ff' }}
          />
        </Card>
      </Col>
      <Col span={4}>
        <Card>
          <Statistic
            title="Selected"
            value={statistics.selected}
            valueStyle={{ color: '#fa8c16' }}
          />
        </Card>
      </Col>
      <Col span={4}>
        <Card>
          <Statistic
            title="Processing"
            value={statistics.processing}
            valueStyle={{ color: '#13c2c2' }}
            suffix={localProcessingStatus.status && <LoadingOutlined spin />}
          />
        </Card>
      </Col>
      <Col span={4}>
        <Card>
          <Statistic
            title="Processed"
            value={statistics.processed}
            valueStyle={{ color: '#52c41a' }}
          />
        </Card>
      </Col>
      <Col span={4}>
        <Card>
          <Statistic
            title="Skipped"
            value={statistics.skipped}
            valueStyle={{ color: '#f5222d' }}
          />
        </Card>
      </Col>
    </Row>
  );

  const renderBatchActions = () => (
    <div style={{ marginBottom: '16px' }}>
      <Space>
        <Badge count={selectedVideos.length}>
          <Button
            type="primary"
            disabled={selectedVideos.length === 0}
            onClick={() => handleMarkAsSelected(selectedVideos)}
          >
            Mark Selected as Ready
          </Button>
        </Badge>
        <Badge count={selectedVideos.length}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={selectedVideos.length === 0}
            onClick={handleProcessSelectedVideos}
          >
            Process Selected Videos
          </Button>
        </Badge>
        <Button
          type="default"
          icon={<PlayCircleOutlined />}
          onClick={handleProcessReadyVideos}
        >
          Process Ready Videos
        </Button>
        <Button
          disabled={selectedVideos.length === 0}
          onClick={() => onVideoSelect([], 'clear')}
        >
          Clear Selection
        </Button>
        {localProcessingStatus.status && (
          <div style={{ marginLeft: '16px' }}>
            <Space>
              <LoadingOutlined spin />
              <Text>Processing {localProcessingStatus.count} videos...</Text>
              <Progress 
                type="circle" 
                size="small" 
                percent={Math.round((localProcessingStatus.processed || 0) / localProcessingStatus.count * 100)} 
              />
            </Space>
          </div>
        )}
      </Space>
    </div>
  );

  return (
    <div>
      {renderStatistics()}
      {renderFilters()}
      {renderBatchActions()}
      
      <Card>
        <Table
          columns={columns}
          dataSource={rawVideos}
          rowKey="_id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} of ${total} videos`,
            onChange: (page, pageSize) => {
              setPagination(prev => ({
                ...prev,
                current: page,
                pageSize: pageSize
              }));
            }
          }}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>
    </div>
  );
};

export default RawVideoPanel;