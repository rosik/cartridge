// @flow
import * as R from 'ramda';
import { createSelector } from 'reselect';
import type { State } from 'src/store/rootReducer';
import type { ServerStatWithUUID } from 'src/store/reducers/clusterPage.reducer';
import type { Replicaset, Server } from 'src/generated/graphql-typing';

const prepareReplicasetList = (
  replicasetList: Replicaset[],
  serverStat: ?ServerStatWithUUID[]
): Replicaset[] => replicasetList.map(replicaset => {
  const servers = replicaset.servers.map(server => {
    const stat = (serverStat || []).find(stat => stat.uuid === server.uuid);

    return {
      ...server,
      statistics: stat ? stat.statistics : null
    };
  });

  return {
    ...replicaset,
    servers
  };
});

const selectServerStat = (state: State): ?ServerStatWithUUID[] => state.clusterPage.serverStat;

const selectReplicasetList = (state: State): ?Replicaset[] => state.clusterPage.replicasetList;

const selectServerList = (state: State): ?Server[] => state.clusterPage.serverList;

export const selectReplicasetListWithStat: (s: State) => Replicaset[] = createSelector(
  [selectReplicasetList, selectServerStat],
  (replicasetList: ?Replicaset[], serverStat: ?ServerStatWithUUID[]): Replicaset[] => (
    replicasetList ? prepareReplicasetList(replicasetList, serverStat) : []
  )
);

type SearchableServer = {
  ...$Exact<Server>,
  searchString: string
};

type WithSearchStringAndServersType = {
  servers: SearchableServer[],
  searchString: string
}

type SearchableReplicaset = {
  ...$Exact<Replicaset>,
  ...$Exact<WithSearchStringAndServersType>
};

export const selectSearchableReplicasetList: (s: State) => SearchableReplicaset[] = createSelector(
  selectReplicasetListWithStat,
  (replicasetList: Replicaset[]): SearchableReplicaset[] => {
    return replicasetList.map(({ servers, ...replicaSet }) => {
      let replicaSetSearchIndex = [...(replicaSet.roles || [])];

      const searchableServers: SearchableServer[] = servers.map (server  => {
        const serverSearchIndex = [server.uri, (server.alias || '')];

        (server.labels || []).forEach(label => {
          if (label) {
            serverSearchIndex.push(`${label.name}:`, label.value);
          }
        });

        replicaSetSearchIndex.push(...serverSearchIndex);

        const searchableServer: SearchableServer = {
          ...server,
          searchString: serverSearchIndex.join(' ').toLowerCase()
        };

        return searchableServer;
      });

      return {
        ...replicaSet,
        searchString: replicaSetSearchIndex.join(' ').toLowerCase(),
        servers: searchableServers
      };
    });
  });

export const filterReplicasetList = (state: State): Replicaset[] => {
  const filterQuery = state.clusterPage.replicasetFilter;
  const tokenizedQuery = filterQuery.toLowerCase().split(' ').map(x => x.trim()).filter(x => !!x);

  const filterByTokens = R.filter(
    R.allPass(
      tokenizedQuery.map(token => r => r.searchString.includes(token) || r.uuid.startsWith(token))
    )
  );

  const filterServerByTokens = R.allPass(
    tokenizedQuery.map(token => searchString => searchString.includes(token))
  );

  const filteredReplicasetList = filterByTokens(selectSearchableReplicasetList(state));

  return filteredReplicasetList.map(replicaSet => {
    let matchingServersCount = 0;

    const servers = replicaSet.servers.map(server => {
      const filterMatching = filterServerByTokens(server.searchString);

      if (filterMatching) {
        matchingServersCount++;
      }

      return {
        ...server,
        filterMatching: filterServerByTokens(server.searchString)
      }
    });

    return {
      ...replicaSet,
      matchingServersCount,
      servers
    }
  });
};

export type ServerCounts = {
  total: number,
  configured: number,
  unconfigured: number,
};

export const getServerCounts: (s: State) => ServerCounts = createSelector(
  selectServerList,
  (serverList: ?Server[]): ServerCounts => (serverList || []).reduce(
    (acc, server) => {
      acc.total++;
      server.replicaset ? acc.configured++ : acc.unconfigured++;
      return acc;
    },
    { configured: 0, total: 0, unconfigured: 0 }
  )
);

export type ReplicasetCounts = {
  total: number,
  unhealthy: number,
};

export const getReplicasetCounts: (s: State) => ReplicasetCounts = createSelector(
  selectReplicasetList,
  (replicasetList: ?Replicaset[]): ReplicasetCounts => {
    return (replicasetList || []).reduce(
      (acc, replicaset) => {
        acc.total++;
        replicaset.status !== 'healthy' && acc.unhealthy++;
        return acc;
      },
      { total: 0, unhealthy: 0 }
    )
  }
);
