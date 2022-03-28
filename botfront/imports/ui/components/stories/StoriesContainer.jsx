import { Loader, Menu } from 'semantic-ui-react';
import React, { useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import LanguageDropdown from '../common/LanguageDropdown';
import SearchBar from './search/SearchBar';
import PageMenu from '../utils/PageMenu';
import { setWorkingDeploymentEnvironment } from '../../store/actions/actions';

const Stories = React.lazy(() => import('./Stories'));

const StoriesContainer = (props) => {
    const { params, setEnvironment } = props;

    // You can use the useEffect hook to run a function when the component has been mounted.
    // When there are no dependencies given to it (the empty array as second argument), it will only run after intial enter
    // Otherwise useEffect would run each time given dependencies would have change of value
    useEffect(() => {
        // I dunno where you are getting env but do that and then...
        setEnvironment('development');
    }, []);

    return (
        <>
            <PageMenu title='Stories' icon='book' withTraining>
                <Menu.Item>
                    <LanguageDropdown />
                </Menu.Item>
                <Menu.Item className='stories-page-menu-searchbar'>
                    <SearchBar />
                </Menu.Item>
            </PageMenu>
            <React.Suspense fallback={<Loader />}>
                <Stories projectId={params.project_id} />
            </React.Suspense>
        </>
    );
};

StoriesContainer.propTypes = {
    params: PropTypes.object.isRequired,
    setEnvironment: PropTypes.func.isRequired,
};

const mapStateToProps = () => ({});

const mapDispatchToProps = {
    // Map function you want to call (let's name it setEnvironment) to the action
    setEnvironment: setWorkingDeploymentEnvironment,
};

// Modify the export to connect to redux store:
export default connect(mapStateToProps, mapDispatchToProps)(StoriesContainer);
