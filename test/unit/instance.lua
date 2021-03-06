#!/usr/bin/env tarantool

local cartridge = require('cartridge')

package.preload['mymodule'] = function()
    return {
        role_name = 'myrole',
    }
end

local ok, err = cartridge.cfg({
    alias = os.getenv('TARANTOOL_ALIAS'),
    workdir = os.getenv('TARANTOOL_WORKDIR'),
    advertise_uri = os.getenv('TARANTOOL_ADVERTISE_URI'),
    cluster_cookie = os.getenv('TARANTOOL_CLUSTER_COOKIE'),
    bucket_count = 3000,
    http_port = os.getenv('TARANTOOL_HTTP_PORT'),
    roles = {
        'cartridge.roles.vshard-storage',
        'cartridge.roles.vshard-router',
        'mymodule',
    },
})

assert(ok, tostring(err))
