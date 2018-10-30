#!/usr/bin/env python3

import json
import time
import pytest
import logging
from conftest import Server

uuid_replicaset = "bbbbbbbb-0000-4000-b000-000000000000"
uuid_s1 = "bbbbbbbb-bbbb-4000-b000-000000033011"
uuid_s2 = "bbbbbbbb-bbbb-4000-b000-000000033012"

cluster = [
    Server(
        alias = 'router',
        instance_uuid = 'aaaaaaaa-aaaa-4000-b000-000000000001',
        replicaset_uuid = 'aaaaaaaa-0000-4000-b000-000000000000',
        roles = ['vshard-router'],
        binary_port = 33001,
        http_port = 8081,
    ),
    Server(
        alias = 'storage-1',
        instance_uuid = uuid_s1,
        replicaset_uuid = uuid_replicaset,
        roles = ['vshard-storage'],
        binary_port = 33011,
        http_port = 8181,
    ),
    Server(
        alias = 'storage-2',
        instance_uuid = uuid_s2,
        replicaset_uuid = uuid_replicaset,
        roles = ['vshard-storage'],
        binary_port = 33012,
        http_port = 8182,
    )
]

def get_master(cluster, replicaset_uuid):
    obj = cluster['router'].graphql("""
        {
            replicasets(uuid: "%s") {
                master { uuid }
            }
        }
    """ % replicaset_uuid)
    assert 'errors' not in obj
    replicasets = obj['data']['replicasets']
    assert len(replicasets) == 1
    return replicasets[0]['master']['uuid']

def set_master(cluster, replicaset_uuid, master_uuid):
    obj = cluster['router'].graphql("""
        mutation {
            edit_replicaset(
                uuid: "%s"
                master: "%s"
            )
        }
    """ % (replicaset_uuid, master_uuid))
    assert 'errors' not in obj, obj['errors'][0]['message']

def get_failover(cluster):
    obj = cluster['router'].graphql("""
        {
            cluster { failover }
        }
    """)
    assert 'errors' not in obj
    return obj['data']['cluster']['failover']

def set_failover(cluster, enabled):
    obj = cluster['router'].graphql("""
        mutation {
            cluster { failover(enabled: %s) }
        }
    """ % ("true" if enabled else "false"))
    assert 'errors' not in obj
    logging.warn('Failover %s' % 'enabled' if enabled else 'disabled')
    return obj['data']['cluster']['failover']

def callrw(cluster, fn, args=[]):
    conn = cluster['router'].conn
    resp = conn.call('vshard.router.callrw', (1, fn, args))
    err = resp[1] if len(resp) > 1 else None
    assert err == None
    return resp[0]

def test_api_master(cluster):
    set_master(cluster, uuid_replicaset, uuid_s2)
    assert get_master(cluster, uuid_replicaset) == uuid_s2
    set_master(cluster, uuid_replicaset, uuid_s1)
    assert get_master(cluster, uuid_replicaset) == uuid_s1

    with pytest.raises(AssertionError) as excinfo:
        set_master(cluster, uuid_replicaset, 'bbbbbbbb-bbbb-4000-b000-000000000003')
    assert str(excinfo.value).split('\n', 1)[0] \
        == 'replicasets[bbbbbbbb-0000-4000-b000-000000000000].master does not exist'

def test_api_failover(cluster):
    assert set_failover(cluster, False) == False
    assert get_failover(cluster) == False
    assert set_failover(cluster, True) == True
    assert get_failover(cluster) == True

def test_switchover(cluster, helpers):
    set_failover(cluster, False)

    set_master(cluster, uuid_replicaset, uuid_s1)
    assert helpers.wait_for(callrw, [cluster, 'get_uuid']) == uuid_s1

    set_master(cluster, uuid_replicaset, uuid_s2)
    assert helpers.wait_for(callrw, [cluster, 'get_uuid']) == uuid_s2

def test_failover(cluster, helpers):
    set_failover(cluster, True)

    set_master(cluster, uuid_replicaset, uuid_s1)
    assert helpers.wait_for(callrw, [cluster, 'get_uuid']) == uuid_s1
    cluster['storage-1'].kill()
    # Wait when router reconfigures
    assert helpers.wait_for(callrw, [cluster, 'get_uuid']) == uuid_s2