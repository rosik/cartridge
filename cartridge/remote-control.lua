#!/usr/bin/env tarantool

--- Tarantool remote control server.
--
-- Allows to control an instance over TCP by `net.box` `call` and `eval`.
-- The server is designed as a partial replacement for the **iproto** protocol.
-- It's most useful when `box.cfg` wasn't configured yet.
--
-- Other `net.box` features aren't supported and will never be.
--
-- @module cartridge.remote-control

local log = require('log')
local errno = require('errno')
local checks = require('checks')
local errors = require('errors')
local socket = require('socket')
local digest = require('digest')
local uuid_lib = require('uuid')
local msgpack = require('msgpack')
local vars = require('cartridge.vars').new('cartridge.remote-control')

vars:new('server')
vars:new('username')
vars:new('password')

local function _pack(...)
    local ret = {...}
    for i = 1, select('#', ...) do
        if ret[i] == nil then
            ret[i] = msgpack.NULL
        end
    end

    return ret
end

local function rc_eval(code, args)
    checks('string', 'table')
    local fun = assert(loadstring(code, 'eval'))
    return _pack(fun(unpack(args)))
end

local function is_callable(fun)
    if type(fun) == 'function' then
        return true
    elseif type(fun) == 'table' then
        local mt = getmetatable(fun)
        return mt and mt.__call
    else
        return false
    end
end

local function rc_call(function_path, args)
    checks('string', 'table')

    local mod_path, delimiter, fun_name = function_path:match('^(.-)([%.%:]?)([_%w]*)$')

    local mod = _G
    if delimiter ~= '' then
        local mod_parts = string.split(mod_path, '.')
        for i = 1, #mod_parts do
            if type(mod) ~= 'table' then
                break
            end
            mod = mod[mod_parts[i]]
        end
    end

    if type(mod) ~= 'table'
    or not is_callable(mod[fun_name])
    then
        error(string.format(
            "Procedure '%s' is not defined", function_path
        ))
    end

    if delimiter == ':' then
        return _pack(mod[fun_name](mod, unpack(args)))
    else
        return _pack(mod[fun_name](unpack(args)))
    end
end

local iproto_code = {
    [0x01] = "iproto_select",
    [0x02] = "iproto_insert",
    [0x03] = "iproto_replace",
    [0x04] = "iproto_update",
    [0x05] = "iproto_delete",
    [0x06] = "iproto_call_16",
    [0x07] = "iproto_auth",
    [0x08] = "iproto_eval",
    [0x09] = "iproto_upsert",
    [0x0a] = "iproto_call",
    [0x0b] = "iproto_execute",
    [0x0c] = "iproto_nop",
    [0x0d] = "iproto_type_stat_max",
    [0x40] = "iproto_ping",
    [0x41] = "iproto_join",
    [0x42] = "iproto_subscribe",
    [0x43] = "iproto_request_vote",
}

local function reply_ok(s, sync, data)
    checks('?', 'number', '?table')

    local header = msgpack.encode({
        [0x00] = 0x00, -- iproto_ok
        [0x05] = 0x00, -- iproto_schema_id
        [0x01] = sync, -- iproto_sync
    })

    if data == nil then
        s:write(msgpack.encode(#header))
        s:write(header)
    else
        local payload = data and msgpack.encode({[0x30] = data})
        s:write(msgpack.encode(#header + #payload))
        s:write(header)
        s:write(payload)
    end
end

local function reply_err(s, sync, ecode, efmt, ...)
    checks('?', 'number', 'number', 'string')

    local header = msgpack.encode({
        [0x00] = 0x8000+ecode, -- iproto_type_error
        [0x05] = 0x00, -- iproto_schema_id
        [0x01] = sync, -- iproto_sync
    })
    local payload = msgpack.encode({
        [0x31] = efmt:format(...)
    })

    s:write(msgpack.encode(#header + #payload))
    s:write(header)
    s:write(payload)
end

local function communicate(s)
    local size_raw = s:read(5)
    if size_raw == '' then
        log.info('Peer closed')
        return false
    end

    local size = msgpack.decode(size_raw)
    local payload = s:read(size)
    local header, pos = msgpack.decode(payload)
    local body = nil
    if pos < size then
        body = msgpack.decode(payload, pos)
    end

    local code = header[0x00]
    local sync = header[0x01]

    if iproto_code[code] == nil then
        reply_err(s, sync, box.error.UNKNOWN,
            "Unknown iproto code 0x%02x", code
        )
        return true

    elseif iproto_code[code] == 'iproto_select' then
        reply_ok(s, sync, {})
        return true

    elseif iproto_code[code] == 'iproto_auth' then
        local username = body[0x23]
        if username ~= vars.username then
            reply_err(s, sync, box.error.ACCESS_DENIED,
                "User '%s' is not found", username
            )
            return false
        end

        local method, scramble = unpack(body[0x21])
        if method == 'chap-sha1' then
            local step_1 = digest.sha1(vars.password)
            local step_2 = digest.sha1(step_1)
            local step_3 = digest.sha1(s._client_salt:sub(1, 20) .. step_2)

            for i = 1, 20 do
                local ss = scramble:sub(i, i):byte()
                local s1 = step_1:sub(i, i):byte()
                local s3 = step_3:sub(i, i):byte()
                if ss ~= bit.bxor(s1, s3) then
                    reply_err(s, sync, box.error.ACCESS_DENIED,
                        "Incorrect password supplied for user '%s'", username
                    )
                    return false
                end
            end
        else
            reply_err(s, sync, box.error.UNSUPPORTED,
                "Authentication method '%s' isnt supported", method
            )
            return false
        end

        s._client_user = username
        s._authorized = true
        reply_ok(s, sync, nil)
        return true

    elseif iproto_code[code] == 'iproto_eval' then
        local code = body[0x27]
        local args = body[0x21]

        if not s._authorized then
            reply_err(s, sync, box.error.ACCESS_DENIED,
                "Execute access to universe '' is denied for user '%s'",
                s._client_user
            )
            return true
        end

        local ok, ret = pcall(rc_eval, code, args)
        if ok then
            reply_ok(s, sync, ret)
            return true
        else
            reply_err(s, sync, box.error.UNKNOWN, ret)
            return true
        end

    elseif iproto_code[code] == 'iproto_call' then
        local fn_name = body[0x22]
        local fn_args = body[0x21]

        if not s._authorized then
            reply_err(s, sync, box.error.ACCESS_DENIED,
                "Execute access to function '%s' is denied for user '%s'",
                fn_name, s._client_user
            )
            return true
        end

        local ok, ret = pcall(rc_call, fn_name, fn_args)
        if ok then
            reply_ok(s, sync, ret)
            return true
        else
            reply_err(s, sync, box.error.UNKNOWN, ret)
            return true
        end


    elseif iproto_code[code] == 'iproto_nop' then
        reply_ok(s, sync, nil)
        return true

    elseif iproto_code[code] == 'iproto_ping' then
        reply_ok(s, sync, nil)
        return true

    else
        reply_err(s, sync, box.error.UNSUPPORTED,
            "Remote Control doesn't support %s", iproto_code[code]
        )
        return true
    end
end

local function rc_handle(s)
    local version = _TARANTOOL:match("^([%d%.]+)") or '???'
    local salt = digest.urandom(32)

    local greeting = string.format(
        '%-63s\n%-63s\n',
        'Tarantool ' .. version .. ' (Binary) ' .. uuid_lib.NULL:str(),
        -- 'Tarantool 1.10.3 (Binary) f1f1ab41-eae1-475b-b4bd-3fa8dd067f4d',
        digest.base64_encode(salt)
    )

    s._client_user = 'guest'
    s._client_salt = salt
    s:write(greeting)

    while true do
        local ok, err = errors.pcall('RemoteControlError', communicate, s)
        if err ~= nil then
            log.error('%s', err)
        end

        if not ok then
            break
        end
    end
end

--- Start remote control server.
-- To connect the server use regular `net.box` connection.
--
-- Access is restricted to the user with specified credentials,
-- which can be passed as `net_box.connect('username:password@host:port')`.
--
-- @function start
-- @local
-- @tparam string host
-- @tparam string|number port
-- @tparam table credentials
-- @tparam string credentials.username
-- @tparam string credentials.password
-- @treturn boolean true
local function start(host, port, opts)
    checks('string', 'string|number', {
        username = 'string',
        password = 'string',
    })

    if vars.server ~= nil then
        return nil, errors.new('RemoteControlError',
            'Already running'
        )
    end

    vars.server = socket.tcp_server(host, port, {
        name = 'remote_control',
        handler = rc_handle,
    })

    if vars.server == nil then
        local err = errors.new('RemoteControlError',
            "Can't start server: %s", errno.strerror()
        )
        return nil, err
    end

    vars.username = opts.username
    vars.password = opts.password
    return true
end

--- Stop the server.
--
-- It doesn't interrupt any existing connections.
--
-- @function stop
-- @local
local function stop()
    if vars.server == nil then
        return
    end

    vars.server:close()
    vars.server = nil
end

return {
    start = start,
    stop = stop,
}
