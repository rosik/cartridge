#!/usr/bin/env tarantool

local admin = require('cartridge.admin')
local gql_types = require('cartridge.graphql.types')
local confapplier = require('cartridge.confapplier')
local gql_boxinfo_schema = require('cartridge.webui.gql-boxinfo').schema
local gql_stat_schema = require('cartridge.webui.gql-stat').schema
local module_name = 'cartridge.webui.api-topology'

local gql_type_replicaset = gql_types.object {
    name = 'Replicaset',
    description = 'Group of servers replicating the same data',
    fields = {
        uuid = {
            kind = gql_types.string.nonNull,
            description = 'The replica set uuid',
        },
        alias = {
            kind = gql_types.string.nonNull,
            description = 'The replica set alias',
        },
        roles = {
            kind = gql_types.list(gql_types.string.nonNull),
            description = 'The role set enabled' ..
                ' on every instance in the replica set',
        },
        status = {
            kind = gql_types.string.nonNull,
            description = 'The replica set health.' ..
                ' It is "healthy" if all instances have status "healthy".' ..
                ' Otherwise "unhealthy".',
        },
        weight = {
            kind = gql_types.float,
            description = 'Vshard replica set weight.' ..
                ' Null for replica sets with vshard-storage role disabled.'
        },
        vshard_group = {
            kind = gql_types.string,
            description = 'Vshard storage group name.' ..
                ' Meaningful only when multiple vshard groups are configured.'
        },
        master = {
            kind = gql_types.nonNull('Server'),
            description = 'The leader according to the configuration.',
        },
        active_master = {
            kind = gql_types.nonNull('Server'),
            description = [[The active leader. It may differ from]] ..
                [[ "master" if failover is enabled and configured leader]] ..
                [[ isn't healthy.]]
        },
        servers = {
            kind = gql_types.list(gql_types.nonNull('Server')).nonNull,
            description = 'Servers in the replica set.'
        },
        all_rw = {
            kind = gql_types.boolean.nonNull,
            description = 'All instances in replica set are rw',
        }
    }
}

local gql_type_label = gql_types.object {
    name = 'Label',
    description = 'Cluster server label',
    fields = {
        name = gql_types.string.nonNull,
        value = gql_types.string.nonNull
    }
}

local gql_type_label_input = gql_types.inputObject {
    name = 'LabelInput',
    description = 'Cluster server label',
    fields = {
        name = gql_types.string.nonNull,
        value = gql_types.string.nonNull
    }
}

local gql_type_server = gql_types.object {
    name = 'Server',
    description = 'A server participating in tarantool cluster',
    fields = {
        alias = gql_types.string,
        uri = gql_types.string.nonNull,
        uuid = gql_types.string.nonNull,
        status = gql_types.string.nonNull,
        message = gql_types.string.nonNull,
        disabled = gql_types.boolean,
        priority = {
            kind = gql_types.int,
            description = 'Failover priority within the replica set',
        },
        replicaset = gql_type_replicaset,
        statistics = gql_stat_schema,
        boxinfo = gql_boxinfo_schema,
        labels = gql_types.list(gql_type_label),
    }
}

local function convert_labels_to_keyvalue(gql_labels)
    if gql_labels == nil then
        return nil
    end

    local result = {}
    for _, item in ipairs(gql_labels) do
        result[item.name] = item.value
    end
    return result
end

local function convert_labels_to_graphql(kv_labels)
    if kv_labels == nil then
        return nil
    end

    local result = {}
    for k, v in pairs(kv_labels) do
        table.insert(result,
            {name = k, value = v}
        )
    end
    return result
end

local gql_type_role = gql_types.object {
    name = 'Role',
    fields = {
        name = gql_types.string.nonNull,
        dependencies = gql_types.list(gql_types.string.nonNull),
    }
}

local function get_servers(_, args)
    local servers = admin.get_servers(args.uuid)
    for _, server in pairs(servers) do
        server.labels = convert_labels_to_graphql(server.labels)
    end
    return servers
end

local function get_replicasets(_, args)
    local replicasets = admin.get_replicasets(args.uuid)
    for _, replicaset in pairs(replicasets) do
        for _, server in pairs(replicaset.servers) do
            server.labels = convert_labels_to_graphql(server.labels)
        end
    end
    return replicasets
end

local function probe_server(_, args)
    return admin.probe_server(args.uri)
end

local function join_server(_, args)
    args.labels = convert_labels_to_keyvalue(args.labels)
    return admin.join_server(args)
end

local function edit_server(_, args)
    args.labels = convert_labels_to_keyvalue(args.labels)
    return admin.edit_server(args)
end

local function expel_server(_, args)
    return admin.expel_server(args.uuid)
end

local function disable_servers(_, args)
    return admin.disable_servers(args.uuids)
end

local function edit_replicaset(_, args)
    return admin.edit_replicaset(args)
end

local function get_known_roles(_, _)
    local ret = {}
    for _, role_name in ipairs(confapplier.get_known_roles()) do
        local role = {
            name = role_name,
            dependencies = confapplier.get_role_dependencies(role_name),
        }

        table.insert(ret, role)
    end

    return ret
end

local function get_failover_enabled(_, _)
    return admin.get_failover_enabled()
end

local function set_failover_enabled(_, args)
    return admin.set_failover_enabled(args.enabled)
end


local function init(graphql)

    graphql.add_callback({
        name = 'servers',
        args = {
            uuid = gql_types.string
        },
        kind = gql_types.list('Server'),
        callback = module_name .. '.get_servers',
    })

    graphql.add_callback({
        name = 'replicasets',
        args = {
            uuid = gql_types.string
        },
        kind = gql_types.list('Replicaset'),
        callback = module_name .. '.get_replicasets',
    })

    graphql.add_mutation({
        name = 'probe_server',
        args = {
            uri = gql_types.string.nonNull
        },
        kind = gql_types.boolean,
        callback = module_name .. '.probe_server',
    })

    graphql.add_mutation({
        name = 'join_server',
        args = {
            uri = gql_types.string.nonNull,
            instance_uuid = gql_types.string,
            replicaset_uuid = gql_types.string,
            roles = gql_types.list(gql_types.string.nonNull),
            timeout = gql_types.float,
            labels = gql_types.list(gql_type_label_input),
            vshard_group = gql_types.string,
        },
        kind = gql_types.boolean,
        callback = module_name .. '.join_server',
    })

    graphql.add_mutation({
        name = 'edit_server',
        args = {
            uuid = gql_types.string.nonNull,
            uri = gql_types.string,
            labels = gql_types.list(gql_type_label_input)
        },
        kind = gql_types.boolean,
        callback = module_name .. '.edit_server',
    })

    graphql.add_mutation({
        name = 'expel_server',
        args = {
            uuid = gql_types.string.nonNull,
        },
        kind = gql_types.boolean,
        callback = module_name .. '.expel_server',
    })

    graphql.add_mutation({
        name = 'edit_replicaset',
        args = {
            uuid = gql_types.string.nonNull,
            roles = gql_types.list(gql_types.string.nonNull),
            master = gql_types.list(gql_types.string.nonNull),
            weight = gql_types.float,
            vshard_group = gql_types.string,
            all_rw = gql_types.boolean,
            alias = gql_types.string,
        },
        kind = gql_types.boolean,
        callback = module_name .. '.edit_replicaset',
    })

    graphql.add_callback({
        prefix = 'cluster',
        name = 'failover',
        doc = 'Get current failover state.',
        args = {},
        kind = gql_types.boolean.nonNull,
        callback = module_name .. '.get_failover_enabled',
    })

    graphql.add_callback({
        prefix = 'cluster',
        name = 'known_roles',
        doc = 'Get list of all registered roles and their dependencies.',
        args = {},
        kind = gql_types.list(gql_type_role.nonNull).nonNull,
        callback = module_name .. '.get_known_roles',
    })

    graphql.add_mutation({
        prefix = 'cluster',
        name = 'failover',
        doc = 'Enable or disable automatic failover. '
            .. 'Returns new state.',
        args = {
            enabled = gql_types.boolean.nonNull,
        },
        kind = gql_types.boolean.nonNull,
        callback = module_name .. '.set_failover_enabled',
    })

    graphql.add_mutation({
        prefix = 'cluster',
        name = 'disable_servers',
        doc = 'Disable listed servers by uuid',
        args = {
            uuids = gql_types.list(gql_types.string.nonNull),
        },
        kind = gql_types.list('Server'),
        callback = module_name .. '.disable_servers',
    })

    graphql.add_callback({
        prefix = 'cluster',
        name = 'self',
        doc = 'Get current server',
        args = {},
        kind = gql_types.object({
            name = 'ServerShortInfo',
            description = 'A short server information',
            fields = {
                uri = gql_types.string.nonNull,
                uuid = gql_types.string,
                alias = gql_types.string,
            },
        }),
        callback = module_name .. '.get_self',
    })
end

return {
    init = init,
    gql_type_server = gql_type_server,
    gql_type_replicaset = gql_type_replicaset,

    get_self = admin.get_self,
    get_servers = get_servers,
    get_replicasets = get_replicasets,

    probe_server = probe_server,
    join_server = join_server,
    edit_server = edit_server,
    edit_replicaset = edit_replicaset,
    expel_server = expel_server,
    disable_servers = disable_servers,

    get_known_roles = get_known_roles,
    get_failover_enabled = get_failover_enabled,
    set_failover_enabled = set_failover_enabled,
}
