import * as remote from '@electron/remote';
import { WithTagCategoriesProps } from '@renderer/containers/withTagCategories';
import { BackIn, FetchedGameInfo } from '@shared/back/types';
import { BrowsePageLayout } from '@shared/BrowsePageLayout';
import { ExtensionContribution } from '@shared/extensions/interfaces';
import { LangContainer } from '@shared/lang';
import { memoizeOne } from '@shared/memoize';
import { updatePreferencesData } from '@shared/preferences/util';
import { formatString } from '@shared/utils/StringFormatter';
import { uuid } from '@shared/utils/uuid';
import { Menu, MenuItemConstructorOptions } from 'electron';
import { Game, Playlist, PlaylistGame } from 'flashpoint-launcher';
import * as React from 'react';
import { ConnectedLeftBrowseSidebar } from '../../containers/ConnectedLeftBrowseSidebar';
import { WithPreferencesProps } from '../../containers/withPreferences';
import { UpdateView, ViewGameSet } from '../../interfaces';
import { gameDragDataType, gameScaleSpan } from '../../Util';
import { LangContext } from '../../util/lang';
import { queueOne } from '../../util/queue';
import { FancyAnimation } from '../FancyAnimation';
import { GameGrid } from '../GameGrid';
import { GameList } from '../GameList';
import { InputElement } from '../InputField';
import { ResizableSidebar, SidebarResizeEvent } from '../ResizableSidebar';
import { Spinner } from '../Spinner';
import path = require('path');
import { newGame } from '@shared/utils/misc';
import { RequestState } from '@renderer/store/main/enums';

type Pick<T, K extends keyof T> = { [P in K]: T[P]; };
type StateCallback1 = Pick<BrowsePageState, 'currentGameInfo'|'isEditingGame'|'isNewGame'|'currentPlaylistEntry'>;

export type GameDragEventData = {
  gameId: string;
  index: number;
}

export type GameDragData = {
  sourceTable: string;
  gameId: string;
  index: number;
}

type OwnProps = {
  sourceTable: string;
  games: ViewGameSet;
  gamesTotal?: number;
  metaState?: RequestState;
  searchStatus: string | null;
  playlists: Playlist[];
  playlistIconCache: Record<string, string>;
  onSaveGame: (info: FetchedGameInfo, playlistEntry?: PlaylistGame) => Promise<FetchedGameInfo | null>;
  onDeleteGame: (gameId: string) => void;
  onMovePlaylistGame: (sourceIdx: number, destIdx: number) => void;
  updateView: UpdateView;

  /** Currently selected game (if any). */
  selectedGameId?: string;
  /** Currently selected playlist (if any). */
  selectedPlaylistId?: string;
  /** Generator for game context menu */
  onGameContextMenu: (gameId: string) => void;
  /** Called when a game is selected. */
  onSelectGame: (gameId?: string) => void;
  /** Called when a playlist is selected. */
  onSelectPlaylist: (library: string, playlistId: string | null) => void;
  /** Called when a playlist is updated */
  onUpdatePlaylist: (playlist: Playlist) => void;
  /** Called when a playlist is deleted */
  onDeletePlaylist: (playlist: Playlist) => void;
  /** Clear the current search query (resets the current search filters). */
  clearSearch: () => void;
  /** If the "New Game" button was clicked (silly way of passing the event from the footer the the browse page). */
  wasNewGameClicked: boolean;
  /** "Route" of the currently selected library (empty string means no library). */
  gameLibrary: string;
  /** Updates to clear platform icon cache */
  logoVersion: number;
  /** Context menu additions */
  contextButtons: ExtensionContribution<'contextButtons'>[];
};

export type BrowsePageProps = OwnProps & WithPreferencesProps & WithTagCategoriesProps;

export type BrowsePageState = {
  /** Current quick search string (used to jump to a game in the list, not to filter the list). */
  quickSearch: string;
  /** Currently dragged game (if any). */
  draggedGameIndex: number | null;

  /** Buffer for the selected game (all changes are made to the game until saved). */
  currentGameInfo?: FetchedGameInfo;
  /** Buffer for the playlist notes of the selected game/playlist (all changes are made to the game until saved). */
  currentPlaylistEntry?: PlaylistGame;
  /** If the "edit mode" is currently enabled. */
  isEditingGame: boolean;
  /** If the selected game is a new game being created. */
  isNewGame: boolean;

  /** Buffer for the selected playlist (all changes are made to this until saved). */
  currentPlaylist?: Playlist;
  isEditingPlaylist: boolean;
  isNewPlaylist: boolean;

};

/** Page displaying the games and playlists. */
export class BrowsePage extends React.Component<BrowsePageProps, BrowsePageState> {
  static contextType = LangContext;
  declare context: React.ContextType<typeof LangContext>;

  /** Reference of the game grid/list element. */
  gameGridOrListRef: HTMLDivElement | null = null;
  /** A timestamp of the previous the the quick search string was updated */
  _prevQuickSearchUpdate = 0;
  gameBrowserRef: React.RefObject<HTMLDivElement> = React.createRef();
  /** The "setState" function but bound to this instance. */
  boundSetState = this.setState.bind(this);

  /** Time it takes before the current "quick search" string to reset after a change was made (in milliseconds). */
  static readonly quickSearchTimeout: number = 1500;

  constructor(props: BrowsePageProps) {
    super(props);
    // Set initial state (this is set up to remove all "setState" calls)
    const initialState: BrowsePageState = {
      quickSearch: '',
      isEditingGame: false,
      isNewGame: false,
      isEditingPlaylist: false,
      isNewPlaylist: false,
      draggedGameIndex: null,
    };
    const assignToState = <T extends keyof BrowsePageState>(state: Pick<BrowsePageState, T>) => { Object.assign(initialState, state); };
    this.updateCurrentGame(this.props.selectedGameId, this.props.selectedPlaylistId);
    this.createNewGameIfClicked(false, assignToState);
    this.state = initialState;
  }

  componentDidUpdate(prevProps: BrowsePageProps, prevState: BrowsePageState) {
    const { gameLibrary, selectedGameId, selectedPlaylistId } = this.props;
    const { isEditingGame } = this.state;
    // Check if it started or ended editing
    if (isEditingGame != prevState.isEditingGame) {
      this.updateCurrentGame(this.props.selectedGameId, this.props.selectedPlaylistId);
    }
    // Update current game and add-apps if the selected game changes
    if (selectedGameId && selectedGameId !== prevProps.selectedGameId) {
      this.updateCurrentGame(this.props.selectedGameId, this.props.selectedPlaylistId);
      this.setState({ isEditingGame: false });
    }
    // Deselect the current game if the game has been deselected (from outside this component most likely)
    if (selectedGameId === undefined && this.state.currentGameInfo && !this.state.isNewGame) {
      this.setState({
        currentGameInfo: undefined,
        currentPlaylistEntry: undefined,
        isNewGame: false,
        isEditingGame: false
      });
    }
    // Update current game and add-apps if the selected game changes
    if (gameLibrary === prevProps.gameLibrary &&
        selectedPlaylistId !== prevProps.selectedPlaylistId) {
      this.setState({
        currentGameInfo: undefined,
        isNewGame: false,
        isEditingGame: false
      });
    }
    // Create a new game if the "New Game" button is pushed
    this.createNewGameIfClicked(prevProps.wasNewGameClicked);
    // Check the library selection changed (and no game is selected)
    if (!selectedGameId && gameLibrary !== prevProps.gameLibrary) {
      this.setState({
        currentGameInfo: undefined,
        isNewGame: false,
        isEditingGame: false
      });
    }
  }

  render() {
    const strings = this.context;
    const { games, selectedGameId, selectedPlaylistId } = this.props;
    const { draggedGameIndex } = this.state;
    const extremeTags = this.props.preferencesData.tagFilters.filter(t => !t.enabled && t.extreme).reduce<string[]>((prev, cur) => prev.concat(cur.tags), []);
    // Render
    return (
      <div
        className='game-browser'
        ref={this.gameBrowserRef}>
        <ResizableSidebar
          show={this.props.preferencesData.browsePageShowLeftSidebar}
          divider='after'
          width={this.props.preferencesData.browsePageLeftSidebarWidth}
          onResize={this.onLeftSidebarResize}>
          <ConnectedLeftBrowseSidebar
            library={this.props.gameLibrary}
            playlists={this.props.playlists}
            selectedPlaylistID={selectedPlaylistId || ''}
            isEditing={this.state.isEditingPlaylist}
            isNewPlaylist={this.state.isNewPlaylist}
            currentPlaylist={this.state.currentPlaylist}
            playlistIconCache={this.props.playlistIconCache}
            onDelete={this.onDeletePlaylist}
            onSave={this.onSavePlaylist}
            onCreate={this.onCreatePlaylistClick}
            onImport={() => this.onImportPlaylistClick(strings)}
            onDiscard={this.onDiscardPlaylistClick}
            onEditClick={this.onEditPlaylistClick}
            onDrop={this.onPlaylistDrop}
            onItemClick={this.onPlaylistClick}
            onSetIcon={this.onPlaylistSetIcon}
            onTitleChange={this.onPlaylistTitleChange}
            onAuthorChange={this.onPlaylistAuthorChange}
            onDescriptionChange={this.onPlaylistDescriptionChange}
            onExtremeToggle={this.onPlaylistExtremeToggle}
            onKeyDown={this.onPlaylistKeyDown}
            onShowAllClick={this.onLeftSidebarShowAllClick}
            onDuplicatePlaylist={this.onDuplicatePlaylist}
            onExportPlaylist={(playlistId) => this.onExportPlaylist(strings, playlistId)}
            onContextMenu={this.onPlaylistContextMenuMemo(strings, this.state.isEditingPlaylist, this.props.selectedPlaylistId)} />
        </ResizableSidebar>
        { this.props.metaState === RequestState.RECEIVED ? (
          <div
            className='game-browser__center'
            onKeyDown={this.onCenterKeyDown}>
            {(() => {
              if (this.props.preferencesData.browsePageLayout === BrowsePageLayout.grid) {
              // (These are kind of "magic numbers" and the CSS styles are designed to fit with them)
                const height: number = calcScale(350, this.props.preferencesData.browsePageGameScale);
                const width: number = (height * 0.666) | 0;
                return (
                  <GameGrid
                    games={games}
                    updateView={this.props.updateView}
                    gamesTotal={this.props.gamesTotal ? this.props.gamesTotal : Object.keys(games).length}
                    selectedGameId={selectedGameId}
                    draggedGameIndex={draggedGameIndex}
                    extremeTags={extremeTags}
                    noRowsRenderer={this.noRowsRendererMemo(strings.browse)}
                    onGameSelect={this.onGameSelect}
                    onGameLaunch={this.onGameLaunch}
                    onContextMenu={this.props.onGameContextMenu}
                    onGameDragStart={this.onGameDragStart}
                    onGameDragEnd={this.onGameDragEnd}
                    cellWidth={width}
                    cellHeight={height}
                    logoVersion={this.props.logoVersion}
                    screenshotPreviewMode={this.props.preferencesData.screenshotPreviewMode}
                    screenshotPreviewDelay={this.props.preferencesData.screenshotPreviewDelay}
                    hideExtremeScreenshots={this.props.preferencesData.hideExtremeScreenshots}
                    gridRef={this.gameGridOrListRefFunc} />
                );
              } else {
                const height: number = calcScale(30, this.props.preferencesData.browsePageGameScale);
                return (
                  <GameList
                    sourceTable={this.props.sourceTable}
                    games={games}
                    gamesTotal={this.props.gamesTotal ? this.props.gamesTotal : Object.keys(games).length}
                    insidePlaylist={!!this.props.selectedPlaylistId}
                    selectedGameId={selectedGameId}
                    draggedGameIndex={draggedGameIndex}
                    showExtremeIcon={this.props.preferencesData.browsePageShowExtreme}
                    extremeTags={extremeTags}
                    noRowsRenderer={this.noRowsRendererMemo(strings.browse)}
                    onGameSelect={this.onGameSelect}
                    onGameLaunch={this.onGameLaunch}
                    onContextMenu={this.props.onGameContextMenu}
                    onGameDragStart={this.onGameDragStart}
                    onGameDragEnd={this.onGameDragEnd}
                    updateView={this.props.updateView}
                    onMovePlaylistGame={this.onMovePlaylistGame}
                    rowHeight={height}
                    logoVersion={this.props.logoVersion}
                    listRef={this.gameGridOrListRefFunc} />
                );
              }
            })()}
          </div>
        ) : (
          <div className='game-browser__center'>
            <div className='game-browser__center-inner'>
              <div className='game-browser__loading'>
                <FancyAnimation
                  normalRender={(
                    <div>{this.props.searchStatus || strings.misc.searching}</div>
                  )}
                  fancyRender={(
                    <>
                      <div>{this.props.searchStatus || strings.misc.searching}</div>
                      <Spinner/>
                    </>
                  )}/>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  private noRowsRendererMemo = memoizeOne((strings: LangContainer['browse']) => {
    return () => (
      <div className='game-list__no-games'>
        { this.props.selectedPlaylistId ? (
          /* Empty Playlist */
          <>
            <h2 className='game-list__no-games__title'>{strings.emptyPlaylist}</h2>
            <br/>
            <p>{formatString(strings.dropGameOnLeft, <i>{strings.leftSidebar}</i>)}</p>
          </>
        ) : this.props.gamesTotal != undefined ? (
          <>
            <h1 className='game-list__no-games__title'>{strings.noGamesFound}</h1>
            <br/>
            { this.props.gamesTotal > 1 ? (
              <>
                {strings.noGameMatchedDesc}
                <br/>
                {strings.noGameMatchedSearch}
              </>
            ) : (
              <>{strings.thereAreNoGames}</>
            ) }
          </>
        ) : <h1 className='game-list__no-games__title'>{strings.searching}</h1> }
      </div>
    );
  });

  private onPlaylistContextMenuMemo = memoizeOne((strings: LangContainer, isEditing: boolean, selectedPlaylistId?: string) => {
    return (event: React.MouseEvent<HTMLDivElement, MouseEvent>, playlistId: string) => {
      if (!isEditing || selectedPlaylistId != playlistId) { // Don't export a playlist in the back while it's being edited in the front
        const contextButtons: MenuItemConstructorOptions[] = [{
          label: strings.menu.duplicatePlaylist,
          click: () => {
            this.onDuplicatePlaylist(playlistId);
          }
        },
        {
          label: strings.menu.exportPlaylist,
          enabled: !window.Shared.isBackRemote, // (Local "back" only)
          click: () => {
            this.onExportPlaylist(strings, playlistId);
          },
        }];

        // Add extension contexts
        for (const contribution of this.props.contextButtons) {
          for (const contextButton of contribution.value) {
            if (contextButton.context === 'playlist') {
              contextButtons.push({
                label: contextButton.name,
                click: () => {
                  window.Shared.back.request(BackIn.GET_PLAYLIST, playlistId)
                  .then(playlist => {
                    window.Shared.back.send(BackIn.RUN_COMMAND, contextButton.command, [playlist]);
                  });
                }
              });
            }
          }
        }

        return (
          openContextMenu(contextButtons)
        );
      }
    };
  });

  /** Deselect without clearing search (Right sidebar will search itself) */
  onRightSidebarDeselectPlaylist = (): void => {
    const { onSelectPlaylist } = this.props;
    if (onSelectPlaylist) { onSelectPlaylist(this.props.gameLibrary, null); }
  };

  onLeftSidebarResize = (event: SidebarResizeEvent): void => {
    const maxWidth = (this.getGameBrowserDivWidth() - this.props.preferencesData.browsePageRightSidebarWidth) - 5;
    const targetWidth = event.startWidth + event.event.clientX - event.startX;
    updatePreferencesData({
      browsePageLeftSidebarWidth: Math.min(targetWidth, maxWidth)
    });
  };

  onRightSidebarResize = (event: SidebarResizeEvent): void => {
    const maxWidth = (this.getGameBrowserDivWidth() - this.props.preferencesData.browsePageLeftSidebarWidth) - 5;
    const targetWidth = event.startWidth + event.startX - event.event.clientX;
    updatePreferencesData({
      browsePageRightSidebarWidth: Math.min(targetWidth, maxWidth)
    });
  };

  getGameBrowserDivWidth(): number {
    if (!document.defaultView) { throw new Error('"document.defaultView" missing.'); }
    if (!this.gameBrowserRef.current) { throw new Error('"game-browser" div is missing.'); }
    return parseInt(document.defaultView.getComputedStyle(this.gameBrowserRef.current).width || '', 10);
  }

  onGameSelect = (gameId?: string): void => {
    if (this.props.selectedGameId !== gameId) {
      this.props.onSelectGame(gameId);
    }
  };

  onGameLaunch = async (gameId: string): Promise<void> => {
    await window.Shared.back.request(BackIn.LAUNCH_GAME, gameId);
  };

  onCenterKeyDown = (event: React.KeyboardEvent): void => {
    const key: string = event.key.toLowerCase();
    if (!event.ctrlKey && !event.altKey) { // (Don't add CTRL or ALT modified key presses)
      if (key === 'backspace') { // (Backspace - Remove a character)
        const timedOut = updateTime.call(this);
        let newString: string = (timedOut ? '' : this.state.quickSearch);
        newString = newString.substring(0, newString.length - 1);
        this.setState({ quickSearch: newString });
      } else if (key.length === 1) { // (Single character - add it to the search string)
        const timedOut = updateTime.call(this);
        const newString: string = (timedOut ? '' : this.state.quickSearch) + key;
        this.setState({ quickSearch: newString });
      }
    }

    /** Check if the current quick search has timed out (and should reset). */
    function updateTime(this: BrowsePage): boolean {
      const now: number = Date.now();
      const timedOut: boolean = (now - this._prevQuickSearchUpdate > BrowsePage.quickSearchTimeout);
      this._prevQuickSearchUpdate = now;
      return timedOut;
    }
  };

  onGameDragStart = (event: React.DragEvent, dragEventData: GameDragEventData): void => {
    const data: GameDragData = {
      ...dragEventData,
      sourceTable: this.props.sourceTable
    };
    console.log(data);
    this.setState({ draggedGameIndex: dragEventData.index });
    event.dataTransfer.setData(gameDragDataType, JSON.stringify(data));
  };

  onGameDragEnd = (event: React.DragEvent): void => {
    this.setState({ draggedGameIndex: null });
    event.dataTransfer.clearData(gameDragDataType);
  };

  onMovePlaylistGame = async (sourceIdx: number, destIdx: number): Promise<void> => {
    this.props.onMovePlaylistGame(sourceIdx, destIdx);
  };

  onDeleteSelectedGame = async (): Promise<void> => {
    // Delete the game
    if (this.props.selectedGameId) {
      this.props.onDeleteGame(this.props.selectedGameId);
    }
    // Deselect the game
    this.props.onSelectGame(undefined);
    // Reset the state related to the selected game
    this.setState({
      currentGameInfo: undefined,
      currentPlaylistEntry: undefined,
      isNewGame: false,
      isEditingGame: false
    });
    // Focus the game grid/list
    this.focusGameGridOrList();
  };

  onRemoveSelectedGameFromPlaylist = async (): Promise<void> => {
    // Remove game from playlist
    if (this.state.currentGameInfo) {
      if (this.state.currentPlaylist) {
        await window.Shared.back.request(BackIn.DELETE_PLAYLIST_GAME, this.state.currentPlaylist.id, this.state.currentGameInfo.game.id);
      } else { logError('No playlist is selected'); }
    } else { logError('No game is selected'); }

    // Deselect the game
    this.props.onSelectGame(undefined);

    // Reset the state related to the selected game
    this.setState({
      currentGameInfo: undefined,
      currentPlaylistEntry: undefined,
      isNewGame: false,
      isEditingGame: false
    });

    if (this.state.currentPlaylist) {
      this.props.onUpdatePlaylist(this.state.currentPlaylist);
    }

    function logError(text: string) {
      console.error('Unable to remove game from selected playlist - ' + text);
    }
  };

  onEditGame = (game: Partial<Game>) => {
    log.debug('Launcher', `Editing: ${JSON.stringify(game)}`);
    if (this.state.currentGameInfo) {
      const ng = newGame();
      Object.assign(ng, {...this.state.currentGameInfo.game, ...game});
      this.setState({
        currentGameInfo: {
          game: ng,
          activeConfig: this.state.currentGameInfo.activeConfig,
          configs: this.state.currentGameInfo.configs,
        }
      });
    }
  };

  onEditPlaylistNotes = (text: string): void => {
    if (this.state.currentPlaylistEntry) {
      this.setState({
        currentPlaylistEntry: {
          ...this.state.currentPlaylistEntry,
          notes: text
        }
      });
    }
  };

  /** Replace the "current game" with the selected game (in the appropriate circumstances). */
  updateCurrentGame = queueOne(async (gameId?: string, playlistId?: string): Promise<void> => {
    // Find the selected game in the selected playlist
    if (gameId) {
      let gamePlaylistEntry: PlaylistGame | null;

      if (playlistId) {
        gamePlaylistEntry = await window.Shared.back.request(BackIn.GET_PLAYLIST_GAME, playlistId, gameId);
      }

      // Update game
      window.Shared.back.request(BackIn.GET_GAME, gameId)
      .then(fetchedInfo => {
        if (fetchedInfo) {
          this.setState({
            currentGameInfo: fetchedInfo,
            currentPlaylistEntry: gamePlaylistEntry == null ? undefined : gamePlaylistEntry,
            isNewGame: false,
          });
        } else { console.log(`Failed to get game. Game is undefined (GameID: "${gameId}").`); }
      });
    }
  });

  onStartEditClick = (): void => {
    if (this.props.preferencesData.enableEditing) {
      this.setState({ isEditingGame: true });
    }
  };

  onDiscardEditClick = (): void => {
    this.setState({
      isEditingGame: false,
      isNewGame: false,
      currentGameInfo: this.state.isNewGame ? undefined : this.state.currentGameInfo,
    });
    this.focusGameGridOrList();
  };

  onSaveEditClick = async (): Promise<void> => {
    if (!this.state.currentGameInfo) {
      console.error('Can\'t save game. "currentGame" is missing.');
      return;
    }
    const newInfo = await this.props.onSaveGame(this.state.currentGameInfo, this.state.currentPlaylistEntry);
    this.setState({
      currentGameInfo: newInfo == null ? undefined : newInfo,
      isEditingGame: false,
      isNewGame: false
    });
    this.focusGameGridOrList();
  };

  onUpdateActiveGameData = (activeDataOnDisk: boolean, activeDataId?: number): void => {
    if (this.state.currentGameInfo) {
      const ng = newGame();
      Object.assign(ng, {...this.state.currentGameInfo.game, activeDataOnDisk, activeDataId });
      const newInfo: FetchedGameInfo = {
        game: ng,
        activeConfig: this.state.currentGameInfo.activeConfig,
        configs: this.state.currentGameInfo.configs,
      };
      window.Shared.back.request(BackIn.SAVE_GAME, newInfo)
      .then(() => {
        if (this.state.currentGameInfo) {
          const ng = newGame();
          Object.assign(ng, {...this.state.currentGameInfo.game, activeDataOnDisk, activeDataId });
          this.setState({ currentGameInfo: {
            game: ng,
            activeConfig: this.state.currentGameInfo.activeConfig,
            configs: this.state.currentGameInfo.configs,
          } });
        }
      });
    }
  };

  /**
   * Create a new game if the "New Game" button was clicked
   *
   * @deprecated New game functionality was removed
   * @param prevWasNewGameClicked Was new game clicked last update
   * @param cb Callback to set state
   */
  createNewGameIfClicked(prevWasNewGameClicked: boolean, cb: (state: StateCallback1) => void = this.boundSetState): void {
    const { wasNewGameClicked } = this.props;
    const id = uuid();
    // Create a new game if the "New Game" button is pushed
    if (wasNewGameClicked && !prevWasNewGameClicked) {
      const ng = newGame();
      Object.assign(ng, {
        id: id,
        parentGameId: id,
        title: '',
        alternateTitles: '',
        series: '',
        developer: '',
        publisher: '',
        platform: '',
        dateAdded: new Date().toISOString(),
        dateModified: new Date().toISOString(),
        broken: false,
        extreme: false,
        playMode: '',
        status: '',
        notes: '',
        tags: [],
        source: '',
        applicationPath: '',
        launchCommand: '',
        releaseDate: '',
        version: '',
        originalDescription: '',
        language: '',
        library: this.props.gameLibrary,
        orderTitle: '',
        addApps: [],
        placeholder: false,
        activeDataOnDisk: false
      });
      cb({
        currentGameInfo: {
          game: ng,
          activeConfig: null,
          configs: []
        },
        isEditingGame: true,
        isNewGame: true,
      });
    }
  }

  // -- Left Sidebar --

  onSavePlaylist = (): void => {
    if (this.state.currentPlaylist) {
      window.Shared.back.request(BackIn.SAVE_PLAYLIST, this.state.currentPlaylist)
      .then((data) => {
        this.props.onUpdatePlaylist(data);
      });
      this.setState({
        isEditingPlaylist: false,
        isNewPlaylist: false,
      });
    }
  };

  onImportPlaylistClick = (strings: LangContainer): void => {
    const filePath = remote.dialog.showOpenDialogSync({
      title: strings.dialog.selectPlaylistToImport,
      defaultPath: 'playlists',
      filters: [{
        name: 'Playlist file',
        extensions: ['json'],
      }]
    });
    if (filePath) {
      window.Shared.back.send(BackIn.IMPORT_PLAYLIST, filePath[0], this.props.gameLibrary);
    }
  };

  onCreatePlaylistClick = (): void => {
    this.setState({
      currentPlaylist: {
        filePath: '',
        id: uuid(),
        games: [],
        title: '',
        description: '',
        author: '',
        icon: '',
        library: this.props.gameLibrary,
        extreme: false
      },
      isEditingPlaylist: true,
      isNewPlaylist: true,
    });
    if (this.props.selectedPlaylistId !== undefined) {
      this.props.onSelectPlaylist(this.props.gameLibrary, null);
    }
  };

  onDiscardPlaylistClick = (): void => {
    const newState: Pick<BrowsePageState, 'isEditingPlaylist' | 'isNewPlaylist' | 'currentPlaylist'> = {
      isEditingPlaylist: false,
      isNewPlaylist: false,
    };

    if (this.state.isNewPlaylist) {
      newState.currentPlaylist = undefined;
    }

    this.setState(newState);
  };

  onDeletePlaylist = (): void => {
    if (this.state.currentPlaylist) {
      const playlistId = this.state.currentPlaylist.id;
      window.Shared.back.request(BackIn.DELETE_PLAYLIST, playlistId)
      .then((data) => {
        this.props.onSelectPlaylist(this.props.gameLibrary, null);
        if (data) {
          // DB wipes it, need it to remove it locally
          data.id = playlistId;
          this.props.onDeletePlaylist(data);
        }
      });
    }
  };

  onEditPlaylistClick = () => {
    if (this.state.currentPlaylist) {
      this.setState({
        isEditingPlaylist: true,
        isNewPlaylist: false,
      });
    }
  };

  onPlaylistDrop = (event: React.DragEvent, playlistId: string) => {
    console.log('play drop');
    if (!this.state.isEditingPlaylist) {
      const rawData = event.dataTransfer.getData(gameDragDataType);
      if (rawData) {
        const dragData = JSON.parse(rawData) as GameDragData;
        window.Shared.back.send(BackIn.ADD_PLAYLIST_GAME, playlistId, dragData.gameId);
      }
    }
  };

  onPlaylistClick = (playlistId: string, selected: boolean): void => {
    if (!this.state.isEditingPlaylist || !selected) {
      const playlist = this.props.playlists.find(p => p.id === playlistId);
      this.setState({
        currentPlaylist: playlist,
        isEditingPlaylist: false,
        isNewPlaylist: false,
      });
      this.props.onSelectPlaylist(this.props.gameLibrary, playlistId);
      this.props.clearSearch();
    }
  };

  onPlaylistSetIcon = () => {
    if (this.state.currentPlaylist && this.state.isEditingPlaylist) {
      // Synchronously show a "open dialog" (this makes the main window "frozen" while this is open)
      const filePaths = window.Shared.showOpenDialogSync({
        title: 'Select a file to use as the icon',
        properties: ['openFile'],
        filters: [
          {
            name: 'Image File (.png, .jpg, .jpeg)',
            extensions: ['png', 'jpg', 'jpeg'],
          },
          {
            name: 'All files (*.*)',
            extensions: [],
          }
        ]
      });
      if (filePaths && filePaths.length > 0) {
        toDataURL(filePaths[0])
        .then(dataUrl => {
          if (this.state.currentPlaylist) {
            this.setState({
              currentPlaylist: {
                ...this.state.currentPlaylist,
                icon: dataUrl+''
              }
            });
          }
        })
        .catch((err) => {
          log.error('Launcher', 'Error fetching playlist icon: ' + err);
        });
      }
    }
  };

  onPlaylistTitleChange = (event: React.ChangeEvent<InputElement>) => {
    if (this.state.currentPlaylist) {
      this.setState({
        currentPlaylist: {
          ...this.state.currentPlaylist,
          title: event.target.value,
        }
      });
    }
  };

  onPlaylistAuthorChange = (event: React.ChangeEvent<InputElement>) => {
    if (this.state.currentPlaylist) {
      this.setState({
        currentPlaylist: {
          ...this.state.currentPlaylist,
          author: event.target.value,
        }
      });
    }
  };

  onPlaylistDescriptionChange = (event: React.ChangeEvent<InputElement>) => {
    if (this.state.currentPlaylist) {
      this.setState({
        currentPlaylist: {
          ...this.state.currentPlaylist,
          description: event.target.value,
        }
      });
    }
  };

  onPlaylistExtremeToggle = (isChecked: boolean) => {
    if (this.state.currentPlaylist) {
      this.setState({
        currentPlaylist: {
          ...this.state.currentPlaylist,
          extreme: isChecked
        }
      });
    }
  };

  onPlaylistKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') { this.onSavePlaylist(); }
  };

  onLeftSidebarShowAllClick = (): void => {
    const { clearSearch, onSelectPlaylist } = this.props;
    if (onSelectPlaylist) {
      onSelectPlaylist(this.props.gameLibrary, null);
    }
    if (clearSearch)      { clearSearch(); }
    this.setState({
      isEditingPlaylist: false,
      isNewPlaylist: false,
      currentPlaylist: undefined,
      isEditingGame: false,
      isNewGame: false,
      currentGameInfo: undefined,
      currentPlaylistEntry: undefined,
    });
  };

  onDuplicatePlaylist = (playlistId: string): void => {
    window.Shared.back.send(BackIn.DUPLICATE_PLAYLIST, playlistId);
  };

  onExportPlaylist = (strings: LangContainer, playlistId: string): void => {
    const playlist = this.props.playlists.find(p => p.id === playlistId);
    const filePath = remote.dialog.showSaveDialogSync({
      title: strings.dialog.selectFileToExportPlaylist,
      defaultPath: playlist ? path.basename(playlist.filePath) : 'playlist.json',
      filters: [{
        name: 'Playlist file',
        extensions: ['json'],
      }]
    });
    if (filePath) { window.Shared.back.send(BackIn.EXPORT_PLAYLIST, playlistId, filePath); }
  };

  /** Focus the game grid/list (if this has a reference to one). */
  focusGameGridOrList() {
    // Focus the game grid/list (to make the keyboard inputs work)
    setTimeout(() => {
      if (this.gameGridOrListRef) { this.gameGridOrListRef.focus(); }
    }, 0);
  }

  gameGridOrListRefFunc = (ref: HTMLDivElement | null): void => {
    this.gameGridOrListRef = ref;
  };
}

function calcScale(defHeight: number, scale: number): number {
  return (defHeight + (scale - 0.5) * 2 * defHeight * gameScaleSpan) | 0;
}

function openContextMenu(template: MenuItemConstructorOptions[]): Menu {
  const menu = remote.Menu.buildFromTemplate(template);
  menu.popup({ window: remote.getCurrentWindow() });
  return menu;
}

type FileReaderResult = typeof FileReader['prototype']['result'];

/**
 * Convert the body of a URL to a data URL.
 * This will reject if the request or conversion fails.
 *
 * @param url URL of content to convert.
 */
async function toDataURL(url: string): Promise<FileReaderResult> {
  return fetch(url)
  .then(response => response.blob())
  .then(blob => new Promise<FileReaderResult>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }));
}
