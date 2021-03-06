// @flow
import * as React from 'react';
import { Icon } from 'antd'
import { css } from 'react-emotion';
import type { RouterHistory, Location } from 'react-router';
import Input from 'src/components/Input';
import Modal from 'src/components/Modal';
import PageDataErrorMessage from 'src/components/PageDataErrorMessage';
import ReplicasetEditModal from 'src/components/ReplicasetEditModal';
import ReplicasetList from 'src/components/ReplicasetList';
import ServerEditModal from 'src/components/ServerEditModal';
import ProbeServerModal from 'src/components/ProbeServerModal';
import ServerList from 'src/components/ServerList';
import { addSearchParams, getSearchParams } from 'src/misc/url';
import ClusterConfigManagement from 'src/components/ClusterConfigManagement';
import PageSectionHead from 'src/components/PageSectionHead';
import './Cluster.css';
import BootstrapPanel from 'src/components/BootstrapPanel';
import Button from 'src/components/Button';
import FailoverButton from './child/FailoverButton';
import AuthToggleButton from 'src/components/AuthToggleButton';
import type { AppState } from 'src/store/reducers/ui.reducer';
import type {
  Label,
  Replicaset,
  Server
} from 'src/generated/graphql-typing.js';
import type { RequestStatusType } from 'src/store/commonTypes';
import type {
  JoinServerActionCreator,
  PageDidMountActionCreator,
  ResetPageStateActionCreator,
  SelectReplicasetActionCreator,
  SelectServerActionCreator,
  SetFilterActionCreator,
  SetProbeServerModalVisibleActionCreator,
  UploadConfigActionCreator
} from 'src/store/actions/clusterPage.actions';
import type { ReplicasetCounts, ServerCounts } from 'src/store/selectors/clusterPage';

const styles = {
  clusterFilter: css`
    width: 100%;
    padding-bottom: 10px;
    padding-left: 5px;
    padding-top: 10px;
    box-shadow: 0px 5px 5px 0px #FAFAFA;
    background: #FAFAFA;
    margin-bottom: 10px;
    position: sticky;
    top: 0px;
    z-index: 4;
  `,
  cardMargin: css`
    padding-top: 24px;
    padding-bottom: 24px;

    & + & {
      padding-top: 0;
    }
  `
};

export type ClusterProps = {
  clusterSelf: $PropertyType<AppState, 'clusterSelf'>,
  failover: boolean,
  pageMount: boolean,
  pageDataRequestStatus: RequestStatusType,
  probeServerModalVisible: Boolean,
  replicasetCounts: ReplicasetCounts,
  selectedServerUri: ?string,
  selectedReplicasetUuid: ?string,
  serverList: ?Server[],
  serverCounts: ServerCounts,
  filter: string,
  replicasetList: Replicaset[],
  filteredReplicasetList: Replicaset[],
  showBootstrapModal: boolean,
  showToggleAuth: boolean,
  history: RouterHistory,
  location: Location,

  pageDidMount: PageDidMountActionCreator,
  selectServer: SelectServerActionCreator,
  closeServerPopup: () => void,
  selectReplicaset: SelectReplicasetActionCreator,
  closeReplicasetPopup: () => void,
  bootstrapVshard: () => void,
  joinServer: JoinServerActionCreator,
  expelServer: (s: Server) => void,
  uploadConfig: UploadConfigActionCreator,
  applyTestConfig: (p: {
    uri: ?string
  }) => void,
  createMessage: () => void,
  changeFailover: () => void,
  resetPageState: ResetPageStateActionCreator,
  setVisibleBootstrapVshardModal: (v: boolean) => void,
  setFilter: SetFilterActionCreator,
  setProbeServerModalVisible: SetProbeServerModalVisibleActionCreator
};

export type ClusterState = {
  bootstrapVshardConfirmVisible: boolean,
  joinServerModalVisible: boolean,
  createReplicasetModalVisible: boolean,
  createReplicasetModalDataSource: ?Server,
  expelServerConfirmVisible: boolean,
  expelServerConfirmDataSource: ?Server,
};

class Cluster extends React.Component<ClusterProps, ClusterState> {
  constructor(props: ClusterProps) {
    super(props);

    this.state = {
      bootstrapVshardConfirmVisible: false,
      joinServerModalVisible: false,
      createReplicasetModalVisible: false,
      createReplicasetModalDataSource: null,
      expelServerConfirmVisible: false,
      expelServerConfirmDataSource: null
    };
  }

  componentDidMount() {
    const {
      pageDidMount,
      location
    } = this.props;

    const selectedServerUri = getSearchParams(location.search).s || null;
    const selectedReplicasetUuid = getSearchParams(location.search).r || null;

    pageDidMount(selectedServerUri, selectedReplicasetUuid);
  }

  componentDidUpdate() {
    this.checkOnServerPopupStateChange();
    this.checkOnReplicasetPopupStateChange();
  }

  componentWillUnmount() {
    this.props.resetPageState();
  }

  render() {
    const { pageDataRequestStatus } = this.props;

    return !pageDataRequestStatus.loaded
      ? null
      : pageDataRequestStatus.error
        ? <PageDataErrorMessage error={pageDataRequestStatus.error} />
        : this.renderContent();
  }

  renderContent = () => {
    const {
      clusterSelf,
      filter,
      filteredReplicasetList,
      selectedServerUri,
      probeServerModalVisible,
      replicasetList,
      selectedReplicasetUuid,
      serverCounts,
      showBootstrapModal
    } = this.props;

    const {
      createReplicasetModalVisible,
      expelServerConfirmVisible
    } = this.state;

    const joinServerModalVisible = !!selectedServerUri;
    const editReplicasetModalVisible = !!selectedReplicasetUuid;
    const unlinkedServers = this.getUnlinkedServers();
    const isBootstrap = (clusterSelf && clusterSelf.uuid) || false;

    return (
      <React.Fragment>
        {showBootstrapModal
          ? this.renderBootstrapVshardConfirmModal()
          : null}
        {probeServerModalVisible
          ? this.renderProbeServerModal()
          : null}
        {joinServerModalVisible
          ? this.renderJoinServerModal()
          : null}
        {createReplicasetModalVisible
          ? this.renderCreateReplicasetModal()
          : null}
        {expelServerConfirmVisible
          ? this.renderExpelServerConfirmModal()
          : null}
        {editReplicasetModalVisible
          ? this.renderEditReplicasetModal()
          : null}
        <div className="pages-Cluster app-content">
          <div className="page-inner">
            {unlinkedServers && unlinkedServers.length
              ? (
                <div className={styles.cardMargin}>
                  <PageSectionHead
                    title={`Unconfigured servers (${serverCounts.unconfigured})`}
                    buttons={this.renderServerButtons()}
                  />
                  <div className="pages-Cluster-serverList">
                    <ServerList
                      linked={false}
                      clusterSelf={clusterSelf}
                      dataSource={unlinkedServers}
                      joinServer={this.handleJoinServerRequest}
                      expelServer={this.handleExpelServerRequest}
                      createReplicaset={this.handleCreateReplicasetRequest}
                    />
                  </div>
                </div>
              )
              : null
            }

            <BootstrapPanel />

            {replicasetList.length
              ? (
                <div className={styles.cardMargin}>
                  <PageSectionHead
                    thin={true}
                    title={`Replica sets ${this.getReplicasetsTitleCounters()}`}
                    buttons={
                      unlinkedServers && unlinkedServers.length
                        ? null
                        : this.renderServerButtons()
                    }
                  />

                  {replicasetList.length > 1
                    ? (
                      <div className={styles.clusterFilter}>
                        <Input
                          prefix={<Icon type="search" />}
                          type={'text'}
                          placeholder={'Filter by uri, uuid, role, alias or labels'}
                          value={filter}
                          onChange={this.handleFilterChange}
                        />
                      </div>
                    )
                    : null}

                  {filteredReplicasetList.length
                    ? (
                      <ReplicasetList
                        clusterSelf={clusterSelf}
                        dataSource={filteredReplicasetList}
                        editReplicaset={this.handleEditReplicasetRequest}
                        joinServer={this.handleJoinServerRequest}
                        expelServer={this.handleExpelServerRequest}
                        createReplicaset={this.handleCreateReplicasetRequest}
                        onServerLabelClick={this.handleServerLabelClick}
                      />
                    )
                    : (
                      <div className="trTable-noData">
                        No replicaset found
                      </div>
                    )}
                </div>
              )
              : null
            }

            {isBootstrap && (
              <ClusterConfigManagement
                uploadConfig={this.uploadConfig}
                canTestConfigBeApplied={false}
                applyTestConfig={this.applyTestConfig}
              />
            )}
          </div>
        </div>
      </React.Fragment>
    );
  };

  renderServerButtons = () => {
    const { showToggleAuth } = this.props;
    return ([
      <FailoverButton />,
      showToggleAuth && <AuthToggleButton />,
      <Button
        size={'large'}
        onClick={this.handleProbeServerRequest}
      >
        Probe server
      </Button>
    ]);
  };

  renderBootstrapVshardConfirmModal = () => {
    return (
      <Modal
        visible
        width={691}
        onOk={this.handleBootstrapVshardSubmitRequest}
        onCancel={this.handleBootstrapVshardConfirmCloseRequest}
      >
        Do you really want to bootstrap vshard?
      </Modal>
    );
  };

  renderProbeServerModal = () => {
    return (
      <ProbeServerModal onRequestClose={this.handleProbeServerModalCloseRequest} />
    );
  };

  renderJoinServerModal = () => {
    const { pageMount, pageDataRequestStatus, replicasetList } = this.props;

    const pageDataLoading = !pageMount || !pageDataRequestStatus.loaded || pageDataRequestStatus.loading;
    const server = this.getSelectedServer();
    const serverNotFound = pageDataLoading ? null : !server;

    return (
      <ServerEditModal
        isLoading={pageDataLoading}
        serverNotFound={serverNotFound}
        server={server}
        replicasetList={replicasetList}
        onSubmit={this.handleJoinServerSubmitRequest}
        onRequestClose={this.handleJoinServerModalCloseRequest}
      />
    );
  };

  renderCreateReplicasetModal = () => {
    return (
      <ReplicasetEditModal
        shouldCreateReplicaset
        onRequestClose={this.handleCreateReplicasetModalCloseRequest}
        createReplicasetModalDataSource={this.state.createReplicasetModalDataSource}
      />
    );
  };

  renderExpelServerConfirmModal = () => {
    const { expelServerConfirmDataSource } = this.state;

    return (
      <Modal
        visible
        width={691}
        onOk={this.handleExpelServerSubmitRequest}
        onCancel={this.handleExpelServerConfirmCloseRequest}
      >
        Do you really want to expel the server {expelServerConfirmDataSource && expelServerConfirmDataSource.uri}?
      </Modal>
    );
  };

  renderEditReplicasetModal = () => {
    const { pageMount, pageDataRequestStatus } = this.props;

    const pageDataLoading = !pageMount || !pageDataRequestStatus.loaded || pageDataRequestStatus.loading;
    const replicaset = this.getSelectedReplicaset();
    const replicasetNotFound = pageDataLoading ? null : !replicaset;

    return (
      <ReplicasetEditModal
        isLoading={pageDataLoading}
        replicasetNotFound={replicasetNotFound}
        replicaset={replicaset}
        onRequestClose={this.handleEditReplicasetModalCloseRequest}
      />
    );
  };

  checkOnServerPopupStateChange = () => {
    const { location, selectedServerUri } = this.props;

    const locationSelectedServerUri = getSearchParams(location.search).s || null;

    if (locationSelectedServerUri !== selectedServerUri) {
      if (locationSelectedServerUri) {
        const { selectServer } = this.props;
        selectServer(locationSelectedServerUri);
      } else {
        const { closeServerPopup } = this.props;
        closeServerPopup();
      }
    }
  };

  checkOnReplicasetPopupStateChange = () => {
    const { location, selectedReplicasetUuid } = this.props;

    const locationSelectedReplicasetUuid = getSearchParams(location.search).r || null;

    if (locationSelectedReplicasetUuid !== selectedReplicasetUuid) {
      if (locationSelectedReplicasetUuid) {
        const { selectReplicaset } = this.props;
        selectReplicaset(locationSelectedReplicasetUuid);
      } else {
        const { closeReplicasetPopup } = this.props;
        closeReplicasetPopup();
      }
    }
  };

  handleServerLabelClick = ({ name, value }: Label) => this.props.setFilter(`${name}: ${value}`);

  handleBootstrapVshardConfirmCloseRequest = () => {
    this.props.setVisibleBootstrapVshardModal(false);
  };

  handleBootstrapVshardSubmitRequest = () => {
    const { bootstrapVshard } = this.props;
    bootstrapVshard();
  };

  handleProbeServerRequest = () => {
    this.props.setProbeServerModalVisible(true);
  };

  handleProbeServerModalCloseRequest = () => {
    this.props.setProbeServerModalVisible(false);
  };

  handleJoinServerRequest = (server: Server) => {
    const { history, location } = this.props;
    history.push({
      search: addSearchParams(location.search, { s: server.uri })
    });
  };

  handleJoinServerModalCloseRequest = () => {
    const { history, location } = this.props;
    history.push({
      search: addSearchParams(location.search, { s: null })
    });
  };

  handleJoinServerSubmitRequest = (data: { uri: string, replicasetUuid: string}) => {
    const { joinServer, history, location } = this.props;
    history.push({
      search: addSearchParams(location.search, { s: null })
    });
    joinServer(data.uri, data.replicasetUuid);
  };

  handleCreateReplicasetRequest = (server: Server) => {
    this.setState({
      createReplicasetModalVisible: true,
      createReplicasetModalDataSource: server
    });
  };

  handleCreateReplicasetModalCloseRequest = () => {
    this.setState({
      createReplicasetModalVisible: false,
      createReplicasetModalDataSource: null
    });
  };

  handleExpelServerRequest = (server: Server) => {
    this.setState({
      expelServerConfirmVisible: true,
      expelServerConfirmDataSource: server
    });
  };

  handleExpelServerConfirmCloseRequest = () => {
    this.setState({
      expelServerConfirmVisible: false,
      expelServerConfirmDataSource: null
    });
  };

  handleExpelServerSubmitRequest = () => {
    const { expelServer } = this.props;
    const { expelServerConfirmDataSource } = this.state;
    this.setState(
      {
        expelServerConfirmVisible: false,
        expelServerConfirmDataSource: null
      },
      () => {
        if (expelServerConfirmDataSource) {
          expelServer(expelServerConfirmDataSource);
        }
      },
    );
  };

  handleEditReplicasetRequest = (replicaset: Replicaset) => {
    const { history, location } = this.props;
    history.push({
      search: addSearchParams(location.search, { r: replicaset.uuid })
    });
  };

  handleEditReplicasetModalCloseRequest = () => {
    const { history, location } = this.props;
    history.push({
      search: addSearchParams(location.search, { r: null })
    });
  };

  handleFilterChange = (e: SyntheticInputEvent<HTMLInputElement>) => this.props.setFilter(e.target.value);

  uploadConfig = (data: { data: FormData }) => {
    const { uploadConfig } = this.props;
    uploadConfig(data);
  };

  applyTestConfig = () => {
    const { serverList, applyTestConfig } = this.props;
    if (serverList) {
      applyTestConfig({ uri: serverList[0].uri });
    }
  };

  getUnlinkedServers = (): ?Server[] => {
    const { serverList } = this.props;
    return serverList ? serverList.filter(server => !server.replicaset) : null;
  };

  getSelectedServer = () => {
    const { serverList, selectedServerUri } = this.props;
    return serverList ? serverList.find(server => server.uri === selectedServerUri) : null;
  };

  getSelectedReplicaset = () => {
    const { replicasetList, selectedReplicasetUuid } = this.props;

    return replicasetList
      ? replicasetList.find(replicaset => replicaset.uuid === selectedReplicasetUuid)
      : null;
  };

  getReplicasetsTitleCounters = () => {
    const { configured } = this.props.serverCounts;
    const { total, unhealthy } = this.props.replicasetCounts;
    const replicasets = `(${total} total, ${unhealthy} unhealthy) `;
    const servers= `(${configured} server${configured === 1 ? '' : 's'})`;
    return replicasets + servers;
  }
}

export default Cluster;
