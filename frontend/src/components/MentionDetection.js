import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Form, 
  Input, 
  Button, 
  Select, 
  Switch, 
  Slider, 
  Table, 
  Tag, 
  Alert, 
  notification, 
  Row, 
  Col,
  Divider,
  Space,
  Typography,
  Spin
} from 'antd';
import { 
  SearchOutlined, 
  PlayCircleOutlined, 
  StopOutlined,
  DownloadOutlined,
  EyeOutlined,
  HeartOutlined,
  GlobalOutlined
} from '@ant-design/icons';
import moment from 'moment';
import { mentionApi, keywordsApi, transcriptsApi } from '../services/api';

const { Option } = Select;
const { TextArea } = Input;
const { Text, Title } = Typography;

const MentionDetection = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [results, setResults] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [supportedLanguages, setSupportedLanguages] = useState([]);
  const [serviceStats, setServiceStats] = useState(null);

  useEffect(() => {
    initializeComponent();
  }, []);

  const initializeComponent = async () => {
    try {
      const [languagesRes, statsRes, keywordsRes] = await Promise.allSettled([
        mentionApi.getLanguages(),
        mentionApi.getStats(),
        keywordsApi.getKeywords()
      ]);

      if (languagesRes.status === 'fulfilled') {
        setSupportedLanguages(languagesRes.value.data.supported_languages || ['en', 'hi', 'mr']);
      }

      if (statsRes.status === 'fulfilled') {
        setServiceStats(statsRes.value.data);
      }

      if (keywordsRes.status === 'fulfilled') {
        setKeywords(keywordsRes.value.data || []);
      }
    } catch (error) {
      console.error('Failed to initialize mention detection:', error);
      notification.error({
        message: 'Initialization Error',
        description: 'Failed to load component data. Some features may not work correctly.'
      });
    }
  };

  const handleDetectMentions = async (values) => {
    setLoading(true);
    try {
      // Parse text segments
      const segments = values.segments.split('\n').filter(s => s.trim()).map((segment, index) => ({
        text: segment.trim(),
        start_time: index * 30.0, // 30 seconds per segment simulation
        duration: 30.0,
        language: values.language_preference[0] || 'en'
      }));

      // Parse keywords
      const mentionKeywords = values.keywords.split(',').map(kw => kw.trim()).map(keyword => ({
        text: keyword,
        language: values.language_preference[0] || 'en',
        variations: [],
        weight: 1.0,
        enable_fuzzy: values.enable_fuzzy,
        fuzzy_threshold: values.fuzzy_threshold / 100
      }));

      const requestData = {
        video_id: values.video_id || `test-${Date.now()}`,
        segments: segments,
        keywords: mentionKeywords,
        language_preference: values.language_preference,
        enable_sentiment: values.enable_sentiment,
        enable_context: values.enable_context,
        fuzzy_threshold: values.fuzzy_threshold / 100
      };

      console.log('Sending mention detection request:', requestData);

      const response = await mentionApi.detectMentions(requestData);
      setResults(response.data);

      notification.success({
        message: 'Detection Complete',
        description: `Found ${response.data.total_matches} mentions in ${response.data.processing_time_ms}ms`
      });

    } catch (error) {
      console.error('Mention detection failed:', error);
      notification.error({
        message: 'Detection Failed',
        description: error.response?.data?.detail || error.message || 'An error occurred during mention detection'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSampleData = () => {
    form.setFieldsValue({
      video_id: 'sample-maharashtra-news',
      segments: `मुंबई येथे नवीन मेट्रो प्रकल्पाचे उद्घाटन झाले आहे. हा प्रकल्प महाराष्ट्र सरकारच्या महत्वाकांक्षी योजनांचा भाग आहे.
पुणे शहरात आयटी कंपन्यांची संख्या वाढत चाललेली आहे. तंत्रज्ञान क्षेत्रात महाराष्ट्राची आघाडी कायम आहे.
नागपूर विद्यापीठातील संशोधकांनी नवीन तंत्रज्ञान विकसित केले आहे. या संशोधनामुळे शेतकऱ्यांना फायदा होईल.
मराठी भाषेच्या संवर्धनासाठी नवीन धोरण आखण्यात येत आहे. राज्य सरकार या बाबतीत गंभीर आहे.`,
      keywords: 'महाराष्ट्र, मुंबई, पुणे, तंत्रज्ञान, मराठी, सरकार',
      language_preference: ['mr', 'hi', 'en'],
      enable_sentiment: true,
      enable_context: true,
      enable_fuzzy: true,
      fuzzy_threshold: 80
    });
  };

  const resultColumns = [
    {
      title: 'Keyword',
      dataIndex: 'keyword',
      key: 'keyword',
      render: (text) => <Tag color="blue">{text}</Tag>
    },
    {
      title: 'Matched Text',
      dataIndex: 'matched_text',
      key: 'matched_text',
      render: (text) => <Text code>{text}</Text>
    },
    {
      title: 'Type',
      dataIndex: 'match_type',
      key: 'match_type',
      render: (type) => (
        <Tag color={type === 'exact' ? 'green' : type === 'fuzzy' ? 'orange' : 'purple'}>
          {type.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence_score',
      key: 'confidence_score',
      render: (score) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ 
            width: '60px', 
            height: '6px', 
            backgroundColor: '#f0f0f0', 
            borderRadius: '3px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              width: `${score * 100}%`, 
              height: '100%', 
              backgroundColor: score > 0.8 ? '#52c41a' : score > 0.6 ? '#fa8c16' : '#ff4d4f' 
            }} />
          </div>
          <Text style={{ fontSize: '12px' }}>{(score * 100).toFixed(0)}%</Text>
        </div>
      )
    },
    {
      title: 'Time',
      dataIndex: 'start_time',
      key: 'start_time',
      render: (start, record) => (
        <Text style={{ fontSize: '12px' }}>
          {Math.floor(start / 60)}:{(start % 60).toFixed(0).padStart(2, '0')} - 
          {Math.floor(record.end_time / 60)}:{(record.end_time % 60).toFixed(0).padStart(2, '0')}
        </Text>
      )
    },
    {
      title: 'Language',
      dataIndex: 'language_detected',
      key: 'language_detected',
      render: (lang) => {
        const flags = { en: '🇺🇸', hi: '🇮🇳', mr: '🏴󠁭󠁨󠁸󠁸󠁿' };
        return <Tag>{flags[lang] || '🌐'} {lang.toUpperCase()}</Tag>;
      }
    },
    {
      title: 'Sentiment',
      dataIndex: ['sentiment', 'overall'],
      key: 'sentiment',
      render: (sentiment, record) => {
        if (!sentiment) return <Tag>N/A</Tag>;
        
        const colors = { positive: 'green', negative: 'red', neutral: 'blue' };
        const confidence = record.sentiment?.confidence || 0;
        
        return (
          <div>
            <Tag color={colors[sentiment] || 'default'}>{sentiment}</Tag>
            <div style={{ fontSize: '11px', color: '#666' }}>
              {(confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      }
    }
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Title level={2}>
        <SearchOutlined style={{ marginRight: '10px' }} />
        Multilingual Mention Detection
      </Title>

      {serviceStats && (
        <Alert
          style={{ marginBottom: '20px' }}
          message="Service Statistics"
          description={
            <Space direction="horizontal" size="large">
              <Text>Total Requests: <strong>{serviceStats.total_requests || 0}</strong></Text>
              <Text>Success Rate: <strong>{serviceStats.success_rate ? (serviceStats.success_rate * 100).toFixed(1) : 'N/A'}%</strong></Text>
              <Text>Avg Processing: <strong>{serviceStats.average_processing_time || 0}ms</strong></Text>
              <Text>Performance: <strong>{serviceStats.performance_pairs_per_second || 0} pairs/sec</strong></Text>
            </Space>
          }
          type="info"
          showIcon
        />
      )}

      <Row gutter={[24, 24]}>
        {/* Input Form */}
        <Col xs={24} lg={14}>
          <Card 
            title="Detection Configuration"
            extra={
              <Button 
                size="small" 
                onClick={loadSampleData}
                icon={<DownloadOutlined />}
              >
                Load Sample
              </Button>
            }
          >
            <Form
              form={form}
              layout="vertical"
              onFinish={handleDetectMentions}
              initialValues={{
                language_preference: ['mr', 'hi', 'en'],
                enable_sentiment: true,
                enable_context: true,
                enable_fuzzy: true,
                fuzzy_threshold: 80
              }}
            >
              <Form.Item
                name="video_id"
                label="Video ID"
                help="Identifier for this detection session"
              >
                <Input placeholder="e.g., zee24taas-20241114-001" />
              </Form.Item>

              <Form.Item
                name="segments"
                label="Text Segments"
                rules={[{ required: true, message: 'Please enter text segments' }]}
                help="Enter text segments separated by new lines. Each line represents a different time segment."
              >
                <TextArea
                  rows={8}
                  placeholder="मुंबई येथे नवीन प्रकल्प सुरू झाला आहे&#10;पुणे शहरात तंत्रज्ञान कंपन्यांची वाढ&#10;महाराष्ट्र सरकारचे नवे धोरण..."
                />
              </Form.Item>

              <Form.Item
                name="keywords"
                label="Keywords to Detect"
                rules={[{ required: true, message: 'Please enter keywords' }]}
                help="Enter keywords separated by commas"
              >
                <Input placeholder="महाराष्ट्र, मुंबई, पुणे, तंत्रज्ञान, सरकार" />
              </Form.Item>

              <Form.Item
                name="language_preference"
                label="Language Priority"
                help="Select languages in order of preference"
              >
                <Select
                  mode="multiple"
                  placeholder="Select languages"
                  style={{ width: '100%' }}
                >
                  {supportedLanguages.map(lang => (
                    <Option key={lang} value={lang}>
                      {lang === 'en' ? '🇺🇸 English' : 
                       lang === 'hi' ? '🇮🇳 Hindi' : 
                       lang === 'mr' ? '🏴󠁭󠁨󠁸󠁸󠁿 Marathi' : lang}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Divider />

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="enable_sentiment"
                    label="Sentiment Analysis"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="enable_context"
                    label="Context Generation"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="enable_fuzzy"
                    label="Fuzzy Matching"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="fuzzy_threshold"
                    label="Fuzzy Threshold"
                  >
                    <Slider
                      min={50}
                      max={100}
                      marks={{ 50: '50%', 80: '80%', 100: '100%' }}
                      tooltip={{ formatter: value => `${value}%` }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item>
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  size="large"
                  loading={loading}
                  icon={<PlayCircleOutlined />}
                  block
                >
                  {loading ? 'Processing...' : 'Detect Mentions'}
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* Results Preview */}
        <Col xs={24} lg={10}>
          <Card 
            title="Detection Summary"
            extra={results && (
              <Tag color="green">
                {results.total_matches} matches found
              </Tag>
            )}
          >
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Spin size="large" />
                <div style={{ marginTop: '16px' }}>
                  Analyzing text segments...
                </div>
              </div>
            ) : results ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Card size="small">
                      <Statistic
                        title="Segments"
                        value={results.processed_segments}
                        suffix={`/ ${results.total_segments}`}
                        prefix={<EyeOutlined />}
                      />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small">
                      <Statistic
                        title="Processing"
                        value={results.processing_time_ms}
                        suffix="ms"
                        prefix={<PlayCircleOutlined />}
                      />
                    </Card>
                  </Col>
                </Row>

                {results.languages_detected?.length > 0 && (
                  <div>
                    <Text strong>Languages Detected:</Text>
                    <div style={{ marginTop: '8px' }}>
                      {results.languages_detected.map(lang => {
                        const flags = { en: '🇺🇸', hi: '🇮🇳', mr: '🏴󠁭󠁨󠁸󠁸󠁿' };
                        return (
                          <Tag key={lang} style={{ marginBottom: '4px' }}>
                            {flags[lang] || '🌐'} {lang.toUpperCase()}
                          </Tag>
                        );
                      })}
                    </div>
                  </div>
                )}

                {results.matches?.length > 0 && (
                  <div>
                    <Text strong>Recent Matches:</Text>
                    <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                      {results.matches.slice(0, 5).map((match, index) => (
                        <Card key={index} size="small" style={{ marginBottom: '8px' }}>
                          <div style={{ fontSize: '12px' }}>
                            <Tag size="small" color="blue">{match.keyword}</Tag>
                            <Text code style={{ fontSize: '11px' }}>{match.matched_text}</Text>
                            <div style={{ marginTop: '4px', color: '#666' }}>
                              Confidence: {(match.confidence_score * 100).toFixed(0)}% • 
                              Type: {match.match_type}
                              {match.sentiment && (
                                <> • Sentiment: <Tag size="small" color={
                                  match.sentiment.overall === 'positive' ? 'green' : 
                                  match.sentiment.overall === 'negative' ? 'red' : 'blue'
                                }>{match.sentiment.overall}</Tag></>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </Space>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                <SearchOutlined style={{ fontSize: '48px', marginBottom: '16px' }} />
                <div>Configure detection settings and run analysis to see results here</div>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Detailed Results Table */}
      {results && results.matches && results.matches.length > 0 && (
        <Card 
          title="Detailed Results" 
          style={{ marginTop: '24px' }}
          extra={
            <Button icon={<DownloadOutlined />} size="small">
              Export Results
            </Button>
          }
        >
          <Table
            columns={resultColumns}
            dataSource={results.matches}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `Total ${total} matches`
            }}
            scroll={{ x: 1200 }}
            size="small"
          />
        </Card>
      )}
    </div>
  );
};

export default MentionDetection;