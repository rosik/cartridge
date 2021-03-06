import * as React from 'react';
import Modal from 'src/components/Modal';
import { connect } from 'react-redux';
import { changeFailover, setVisibleFailoverModal } from 'src/store/actions/clusterPage.actions';
import Button from 'src/components/Button';

const description = 'When enabled, every storage starts monitoring instance statuses. \
If a user-specified master goes down, a replica with the lowest UUID takes its place. \
When the user-specified master comes back online, both roles are restored.'

class FailoverButton extends React.Component {

  render() {
    if (!this.props.clusterSelf.configured)
      return null;

    return (
      <React.Fragment>
        <Button
          type={this.props.failover ? 'primary' : 'default'}
          onClick={() => this.props.dispatch(setVisibleFailoverModal(true))}
          size="large"
        >
          {`Failover: ${this.props.failover ? 'enabled' : 'disabled'}`}
        </Button>
        <Modal
          title="Failover control"
          visible={this.props.showFailoverModal}
          width={691}
          onOk={() => this.props.dispatch(changeFailover({ enabled: !this.props.failover }))}
          okText={this.props.failover ? 'Disable' : 'Enable'}
          onCancel={() => this.props.dispatch(setVisibleFailoverModal(false))}
          cancelText={'Close'}
        >
          <p>Current status:{' '}<b>{this.props.failover ? 'enabled' : 'disabled'}</b>.</p>
          <p>{description}</p>
        </Modal>
      </React.Fragment>
    );
  }
}

export default connect(({ app, ui }) => {
  return {
    clusterSelf: app.clusterSelf,
    failover: app.failover,
    showFailoverModal: ui.showFailoverModal
  }
})(FailoverButton);
