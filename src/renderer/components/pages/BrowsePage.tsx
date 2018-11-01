import * as React from 'react';
import { IDefaultProps, ICentralState } from '../../interfaces';
import { ISearchOnSearchEvent } from '../Search';
import { GameList } from '../GameList';
import { IGameOrderChangeEvent } from '../GameOrder';
import { IGameInfo, IAdditionalApplicationInfo, IGameSearchQuery } from '../../../shared/game/interfaces';
import { gameScaleSpan } from '../../Util';
import { BrowseSidebar } from '../BrowseSidebar';
import { GameGrid } from '../GameGrid';
import { BrowsePageLayout } from '../../../shared/BrowsePageLayout';
import { filterSearch, filterExtreme, getOrderFunction, filterBroken, filterPlaylist } from '../../../shared/game/GameFilter';
import { GameCollection } from '../../../shared/game/GameCollection';
import { GameLauncher } from '../../GameLauncher';
import { LeftBrowseSidebar } from '../LeftBrowseSidebar';
import { IGamePlaylist, IGamePlaylistEntry } from 'src/renderer/playlist/interfaces';

export interface IBrowsePageProps extends IDefaultProps {
  central: ICentralState;
  search?: ISearchOnSearchEvent;
  order?: IGameOrderChangeEvent;
  /** Scale of the games */
  gameScale: number;
  /** Layout of the games */
  gameLayout: BrowsePageLayout;
}

export interface IBrowsePageState {
  /** Currently selected game (if any) */
  selectedGame?: IGameInfo;
  /** Currently selected playlist (if any) */
  selectedPlaylist?: IGamePlaylist;
  /** Current quick search string (used to jump to a game in the list, not to filter the list) */
  quickSearch: string;
}

export class BrowsePage extends React.Component<IBrowsePageProps, IBrowsePageState> {
  /** A timestamp of the previous the the quick search string was updated */
  private _prevQuickSearchUpdate: number = 0;

  private static readonly quickSearchTimeout: number = 1500;

  constructor(props: IBrowsePageProps) {
    super(props);
    this.state = {
      quickSearch: '',
    };
    this.noRowsRenderer = this.noRowsRenderer.bind(this);
    this.onGameSelect = this.onGameSelect.bind(this);
    this.onGameLaunch = this.onGameLaunch.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onDeleteSelectedGame = this.onDeleteSelectedGame.bind(this);
    this.onLeftSidebarSelectPlaylist = this.onLeftSidebarSelectPlaylist.bind(this);
    this.onLeftSidebarDeselectPlaylist = this.onLeftSidebarDeselectPlaylist.bind(this);
    this.onLeftSidebarPlaylistChanged = this.onLeftSidebarPlaylistChanged.bind(this);
  }

  componentDidUpdate(prevProps: IBrowsePageProps, prevState: IBrowsePageState) {
    // Check if quick search string changed, and if it isn't empty
    if (prevState.quickSearch !== this.state.quickSearch && this.state.quickSearch !== '') {
      const games: IGameInfo[] = this.orderGames();
      for (let index = 0; index < games.length; index++) {
        const game: IGameInfo = games[index];
        if (game.title.toLowerCase().startsWith(this.state.quickSearch)) {
          this.setState({ selectedGame: game });
          break;
        }
      }
    }
  }

  render() {
    const games: IGameInfo[] = this.orderGames();
    const order = this.props.order || BrowsePage.defaultOrder;
    const selectedGame = this.state.selectedGame;
    const selectedPlaylist = this.state.selectedPlaylist;
    const anyGames: boolean = (this.props.central.games.collection.games.length > 0);
    // Find the selected game in the selected playlist (if both are seleceted)
    let gamePlaylistEntry: IGamePlaylistEntry|undefined;
    if (selectedPlaylist && selectedGame) {
      for (let gameEntry of selectedPlaylist.games) {
        if (gameEntry.id === selectedGame.id) {
          gamePlaylistEntry = gameEntry;
          break;
        }
      }
    }
    // Find additional applications for the selected game (if any)
    let selectedAddApps: IAdditionalApplicationInfo[]|undefined;
    if (selectedGame) {
      selectedAddApps = GameCollection.findAdditionalApplicationsByGameId(this.props.central.games.collection, selectedGame.id);
    }
    // Render
    return (
      <div className='game-browser'>
        {anyGames ? (
          <div className={'game-browser__left simple-scroll'+
                          (selectedGame?'':' game-browser__left--none')+
                          (window.External.preferences.data.browsePageShowLeftSidebar?'':' game-browser__left--hidden')}>
            <LeftBrowseSidebar central={this.props.central}
                               selectedPlaylistID={selectedPlaylist ? selectedPlaylist.id : ''}
                               onSelectPlaylist={this.onLeftSidebarSelectPlaylist}
                               onDeselectPlaylist={this.onLeftSidebarDeselectPlaylist}
                               onPlaylistChanged={this.onLeftSidebarPlaylistChanged} />
          </div>
        ) : undefined}
        <div className='game-browser__center' onKeyDown={this.onKeyDown}>
          {(() => {
            if (this.props.gameLayout === BrowsePageLayout.grid) {
              // (These are kind of "magic numbers" and the CSS styles are designed to fit with them)
              const height: number = calcScale(470, this.props.gameScale);
              const width: number = (height * 0.666) | 0;
              return (
                <GameGrid games={games}
                          selectedGame={selectedGame}
                          gameImages={this.props.central.gameImages}
                          noRowsRenderer={this.noRowsRenderer}
                          onGameSelect={this.onGameSelect}
                          onGameLaunch={this.onGameLaunch}
                          orderBy={order.orderBy}
                          orderReverse={order.orderReverse}
                          cellWidth={width}
                          cellHeight={height}/>
              );
            } else {
              const height: number = calcScale(137.5, this.props.gameScale);
              return (
                <GameList games={games}
                          selectedGame={selectedGame}
                          gameImages={this.props.central.gameImages}
                          noRowsRenderer={this.noRowsRenderer}
                          onGameSelect={this.onGameSelect}
                          onGameLaunch={this.onGameLaunch}
                          orderBy={order.orderBy}
                          orderReverse={order.orderReverse}
                          rowHeight={height}/>
              );
            }
          })()}
        </div>
        {anyGames ? (
          <div className={'game-browser__right'+
                          (selectedGame?'':' game-browser__right--none')+
                          (window.External.preferences.data.browsePageShowRightSidebar?'':' game-browser__right--hidden')}>
            <BrowseSidebar selectedGame={selectedGame} 
                           selectedAddApps={selectedAddApps}
                           gameImages={this.props.central.gameImages}
                           games={this.props.central.games}
                           onDeleteSelectedGame={this.onDeleteSelectedGame}
                           gamePlaylistEntry={gamePlaylistEntry} />
          </div>
        ) : undefined}
      </div>
    );
  }

  private noRowsRenderer() {
    return (
      <div className='game-list__no-games'>
        {this.props.central.gamesDoneLoading ? (
          <>
            <h1 className='game-list__no-games__title'>No Games Found!</h1>
            <br/>
            {(this.props.central.gamesFailedLoading) ? (
              <>
                Have you set the path to the <b>Flashpoint path</b> at the <i>Config</i> page?<br/>
                <br/>
                Note: You have to press <b>"Save & Restart"</b> for the change to take effect.
              </>
            ) : (
              (this.props.central.games.collection.games.length > 0) ? (
                <>
                  No game title matched your search.<br/>
                  Try searching for something less restrictive.
                </>
              ) : (
                <>
                  There are no games.
                </>
              )
            )}
          </>
        ) : (
          <p>
            Loading Games...
          </p>
        )}
      </div>
    );
  }

  private onLeftSidebarSelectPlaylist(playlist: IGamePlaylist): void {
    this.setState({ selectedPlaylist: playlist });
  }

  private onLeftSidebarDeselectPlaylist(): void {
    this.setState({ selectedPlaylist: undefined });
  }

  private onLeftSidebarPlaylistChanged(playlist: IGamePlaylist): void {
    this.forceUpdate();
  }

  private onGameSelect(game?: IGameInfo): void {
    if (this.state.selectedGame !== game) {
      this.setState({ selectedGame: game });
    }
  }

  private onGameLaunch(game: IGameInfo): void {
    const addApps = GameCollection.findAdditionalApplicationsByGameId(this.props.central.games.collection, game.id);
    GameLauncher.launchGame(game, addApps);
  }

  private onKeyDown(event: React.KeyboardEvent): void {
    const key: string = event.key.toLowerCase();
    if (key === 'backspace') { // (Backspace - Remove a character)
      const timedOut = updateTime.call(this);
      let newString: string = (timedOut ? '' : this.state.quickSearch);
      newString = newString.substr(0, newString.length - 1);
      this.setState({ quickSearch: newString });
    } else if (key.length === 1) { // (Single character - add it to the search string)
      const timedOut = updateTime.call(this);
      let newString: string = (timedOut ? '' : this.state.quickSearch) + key;
      this.setState({ quickSearch: newString });
    }

    function updateTime(this: BrowsePage): boolean {
      const now: number = Date.now();
      const timedOut: boolean = (now - this._prevQuickSearchUpdate > BrowsePage.quickSearchTimeout);
      this._prevQuickSearchUpdate = now;
      return timedOut;
    }
  }

  private onDeleteSelectedGame(): void {
    this.setState({ selectedGame: undefined });
  }

  /** Order the games according to the current settings */
  private orderGames(): IGameInfo[] {
    // -- Get the array of games --
    let games = this.props.central.games.collection.games;
    if (!games) { return []; } // (No games found)
    games = games.slice(); // (Copy array)
    // -- Filter games --
    const filters = parseFilters(this.props.search && this.props.search.input || '');
    const extreme: boolean = !window.External.config.data.disableExtremeGames &&
                             window.External.preferences.data.browsePageShowExtreme;
    const broken: boolean = window.External.config.data.showBrokenGames;
    const playlist = this.state.selectedPlaylist;
    const filteredGames = filterSearch(filters, filterBroken(broken, filterExtreme(extreme, filterPlaylist(playlist, games))));
    // -- Order games --
    let orderedGames = filteredGames;
    if (!playlist) { // (Dont order if a playlist is selected - kind of a hack)
      const order = this.props.order || BrowsePage.defaultOrder;
      orderedGames = filteredGames.sort(getOrderFunction(order));      
    }
    // -- Return --
    return orderedGames;
  }

  private static defaultOrder: Readonly<IGameOrderChangeEvent> = {
    orderBy: 'title',
    orderReverse: 'ascending',
  }
}

/**
 * Parse a search string into an object with the different search "types" separated
 * @param input Search string
 */
function parseFilters(input: string): IGameSearchQuery {
  const filter: IGameSearchQuery = {
    text: '',
    platforms: undefined,
    developers: undefined,
    genres: undefined,
  };
  // Abort if string is empty
  if (!input) { return filter; }
  // Do filtering
  const splits = input.replace(/  +/g, ' ').split(' ');
  let str = ''; // Current string that is being built
  let mode = 0; // What "mode" the string current is in (Normal, Platform, Genre etc.)
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    if (!split) { continue; } // Skip if split is empty
    switch(split[0]) {
      case '!': // Platform (1)
        startNewString(split, 1);
        break;
      case '@': // Developer (2)
        startNewString(split, 2);
        break;
      case '#': // Genre (3)
        startNewString(split, 3);
        break;
      default:
        str += split+' ';
        break;
    }
  }
  finishPreviousString();
  return filter;
  // -- Functions --
  /** Start a new string with a given mode */
  function startNewString(split: string, newMode: number) {
    finishPreviousString();
    str = split.substr(1)+' '; // Remove first character and add a space to the end
    mode = newMode;
  }
  /** Add the current string to the filter object where it belongs (depending on its mode) */
  function finishPreviousString() {
    // Clean string up (remove last character which is a space, and turn into lower case)
    let cleanStr = str.substr(0, str.length-1).toLowerCase();
    // Add string at the correct place
    switch (mode) {
      case 0:
        filter.text = cleanStr;
        break;
      case 1:
        if (!filter.platforms) { filter.platforms = []; }
        filter.platforms.push(cleanStr);
        break;
      case 2:
        if (!filter.developers) { filter.developers = []; }
        filter.developers.push(cleanStr);
        break;
      case 3:
        if (!filter.genres) { filter.genres = []; }
        filter.genres.push(cleanStr);
        break;
    }
  }
}

function calcScale(defHeight: number, scale: number): number {
  return (defHeight + (scale - 0.5) * 2 * defHeight * gameScaleSpan) | 0
}
