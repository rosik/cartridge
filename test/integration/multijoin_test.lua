local fio = require('fio')
local t = require('luatest')
local g = t.group('multijoin')

local test_helper = require('test.helper')

local helpers = require('cluster.test_helpers')

local cluster
local servers

g.before_all = function()
    cluster = helpers.Cluster:new({
        datadir = fio.tempdir(),
        use_vshard = false,
        server_command = test_helper.server_command,
        replicasets = {
            {
                alias = 'firstling',
                uuid = helpers.uuid('a'),
                roles = {},
                servers = {
                    {instance_uuid = helpers.uuid('a', 'a', 1)},
                },
            }
        },
    })

    servers = {}
    for i = 1, 2 do
        local http_port = 8090 + i
        local advertise_port = 13310 + i
        local alias = string.format('twin%d', i)

        servers[i] = helpers.Server:new({
            alias = alias,
            command = test_helper.server_command,
            workdir = fio.pathjoin(cluster.datadir, alias),
            cluster_cookie = cluster.cookie,
            http_port = http_port,
            advertise_port = advertise_port,
            instance_uuid = helpers.uuid('b', 'b', i),
            replicaset_uuid = helpers.uuid('b'),
        })
    end

    for _, server in pairs(servers) do
        server:start()
    end
    cluster:start()
end

g.after_all = function()
    for _, server in pairs(servers or {}) do
        server:stop()
    end
    cluster:stop()

    fio.rmtree(cluster.datadir)
    cluster = nil
    servers = nil
end

g.test_patch_topology = function()
    cluster.main_server.net_box:eval([[
        local args = ...

        local errors = require('errors')
        local cluster = require('cluster')
        local membership = require('membership')

        errors.assert('ProbeError', membership.probe_uri(args.twin1.advertise_uri))
        errors.assert('ProbeError', membership.probe_uri(args.twin2.advertise_uri))

        local topology, err = cluster.admin.patch_topology({
            replicasets = {
                {
                    uuid = args.twin1.replicaset_uuid,
                    join_servers = {
                        {
                            uuid = args.twin1.instance_uuid,
                            uri = args.twin1.advertise_uri,
                        },
                        {
                            uuid = args.twin2.instance_uuid,
                            uri = args.twin2.advertise_uri,
                        }
                    }
                }
            }
        })
        assert(topology, tostring(err))
    ]], {{
        twin1 = {
            advertise_uri = servers[1].advertise_uri,
            instance_uuid = servers[1].instance_uuid,
            replicaset_uuid = servers[1].replicaset_uuid,
        },
        twin2 = {
            advertise_uri = servers[2].advertise_uri,
            instance_uuid = servers[2].instance_uuid,
            replicaset_uuid = servers[2].replicaset_uuid,
        }},
    })

    cluster:retrying({}, function() servers[1]:connect_net_box() end)
    cluster:retrying({}, function() servers[2]:connect_net_box() end)
    cluster:wait_until_healthy()
end