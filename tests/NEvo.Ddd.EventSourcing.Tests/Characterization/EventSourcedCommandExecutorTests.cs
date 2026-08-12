using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Proves the shared executor's own lifecycle guarantees — append-before-publish
// ordering, concurrency surfacing through Either.Left, the aggregate-aware
// authorization hook's Option<TAggregate> shape, and the NoStream/Exact(version)
// mapping.
public class EventSourcedCommandExecutorTests
{
    private static (AggregateRepository Repository, AggregateDecider Decider) CreateRealDependencies()
    {
        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { typeof(Document) } };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        var decider = new AggregateDecider(deciderProvider, new MessageContextAccessor());
        var evolver = new AggregateEvolver(Options.Create(configuration));
        var evolverRegistry = new EvolverRegistry([evolver]);
        var repository = new AggregateRepository(new FakeEventStore(), evolverRegistry);
        return (repository, decider);
    }

    private class RecordingPublisher(Func<Event, CancellationToken, Task> onPublish) : IEventPublisher
    {
        public async Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken)
        {
            await onPublish(@event, cancellationToken);
            return Unit.Default;
        }
    }

    [Fact]
    public async Task ExecuteAsync_AppendHappensBeforePublish_SoASynchronousPublishHandlerObservesAppendedState()
    {
        var (repository, decider) = CreateRealDependencies();
        var id = Guid.NewGuid();
        (Document Aggregate, int Version)? observedDuringPublish = null;
        var publisher = new RecordingPublisher(async (_, ct) =>
        {
            var loaded = await repository.LoadAggregateAsync<Document, Guid>(id, ct);
            loaded.IfRight(option => option.IfSome(value => observedDuringPublish = value));
        });
        var executor = new EventSourcedCommandExecutor(repository, publisher);
        var command = new CreateDocument(id, "Data");

        var result = await executor.ExecuteAsync<CreateDocument, Document, Guid>(
            command,
            new Mock<IMessageContext>().Object,
            new AlwaysAllowAuthorization<CreateDocument, Document, Guid>(),
            state => decider.DecideAsync(state, command, CancellationToken.None),
            CancellationToken.None
        );

        result.Should().BeRight();
        observedDuringPublish.Should().NotBeNull();
        observedDuringPublish!.Value.Aggregate.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Data");
        observedDuringPublish.Value.Version.Should().Be(1);
    }

    [Fact]
    public async Task ExecuteAsync_ConcurrencyConflictOnAppend_ReturnsLeftWithAggregateConcurrencyException_NeverThrown()
    {
        // A stale-load / lost-update race (this test's load returns None, but the store
        // has already advanced by append time) is exercised through a mocked repository
        // so the append failure is isolated from the decider's own "already exists"
        // guard — the point under test is that the executor propagates whatever
        // AppendEventsAsync returns, unchanged, as Either.Left, never a thrown exception.
        var id = Guid.NewGuid();
        var repositoryMock = new Mock<IAggregateRepository>();
        var conflict = new AggregateConcurrencyException(id.ToString(), ExpectedStreamState.NoStream, 1);
        repositoryMock.Setup(r => r.LoadAggregateAsync<Document, Guid>(id, It.IsAny<CancellationToken>()))
            .Returns(Option<(Document, int)>.None);
        repositoryMock.Setup(r => r.AppendEventsAsync(id, It.IsAny<IEnumerable<IAggregateEvent<Document, Guid>>>(), It.IsAny<ExpectedStreamState>(), It.IsAny<CancellationToken>()))
            .Returns((EitherAsync<Exception, Unit>)conflict);
        var publisher = new FakeEventPublisher();
        var executor = new EventSourcedCommandExecutor(repositoryMock.Object, publisher);
        var createCommand = new CreateDocument(id, "Data");

        Func<Task> act = async () => await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            createCommand, new Mock<IMessageContext>().Object, new AlwaysAllowAuthorization<DocumentCommand, Document, Guid>(),
            _ => (EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>)(DocumentDomainEvent[])[new DocumentCreated(id, "Data")],
            CancellationToken.None
        );

        await act.Should().NotThrowAsync();
        var result = await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            createCommand, new Mock<IMessageContext>().Object, new AlwaysAllowAuthorization<DocumentCommand, Document, Guid>(),
            _ => (EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>)(DocumentDomainEvent[])[new DocumentCreated(id, "Data")],
            CancellationToken.None
        );

        result.Should().BeLeft().Which.Should().BeSameAs(conflict);
        publisher.PublishedEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task ExecuteAsync_AuthorizationHook_ReceivesNoneOnCreatePath_AndSomeOnMutatePath()
    {
        var (repository, decider) = CreateRealDependencies();
        var id = Guid.NewGuid();
        var publisher = new FakeEventPublisher();
        var executor = new EventSourcedCommandExecutor(repository, publisher);

        var receivedStates = new List<Option<Document>>();
        var authorizationMock = new Mock<IAggregateAuthorization<DocumentCommand, Document, Guid>>();
        authorizationMock
            .Setup(a => a.AuthorizeAsync(It.IsAny<DocumentCommand>(), It.IsAny<Option<Document>>(), It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
            .Callback<DocumentCommand, Option<Document>, IMessageContext, CancellationToken>((_, state, _, _) => receivedStates.Add(state))
            .Returns(Unit.Default);

        var createCommand = new CreateDocument(id, "Data");
        await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            createCommand, new Mock<IMessageContext>().Object, authorizationMock.Object,
            state => decider.DecideAsync(state, createCommand, CancellationToken.None), CancellationToken.None
        );

        var changeCommand = new ChangeDocument(id, "Updated");
        await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            changeCommand, new Mock<IMessageContext>().Object, authorizationMock.Object,
            state => decider.DecideAsync(state, changeCommand, CancellationToken.None), CancellationToken.None
        );

        receivedStates.Should().HaveCount(2);
        receivedStates[0].IsNone.Should().BeTrue();
        receivedStates[1].IsSome.Should().BeTrue();
    }

    [Fact]
    public async Task ExecuteAsync_AuthorizationHookDenies_PreventsAppendAndDecision_OnBothCreateAndMutatePaths()
    {
        var (repository, decider) = CreateRealDependencies();
        var id = Guid.NewGuid();
        var publisher = new FakeEventPublisher();
        var executor = new EventSourcedCommandExecutor(repository, publisher);
        var denial = new Exception("denied");
        var authorizationMock = new Mock<IAggregateAuthorization<DocumentCommand, Document, Guid>>();
        authorizationMock
            .Setup(a => a.AuthorizeAsync(It.IsAny<DocumentCommand>(), It.IsAny<Option<Document>>(), It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
            .Returns(denial);
        var decideInvoked = false;
        Func<Option<Document>, EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>> decide = state =>
        {
            decideInvoked = true;
            return decider.DecideAsync(state, new CreateDocument(id, "Data"), CancellationToken.None);
        };

        var createCommand = new CreateDocument(id, "Data");
        var createResult = await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            createCommand, new Mock<IMessageContext>().Object, authorizationMock.Object, decide, CancellationToken.None
        );

        createResult.Should().BeLeft().Which.Should().BeSameAs(denial);
        decideInvoked.Should().BeFalse();
        var loadedAfterCreateDenial = await repository.LoadAggregateAsync<Document, Guid>(id, CancellationToken.None);
        loadedAfterCreateDenial.Should().BeRight().Which.Should().BeNone();

        // Establish an existing aggregate (authorization allowed this once) so the
        // mutate-path denial below is exercised against a real Some state, not None.
        var allowOnceMock = new Mock<IAggregateAuthorization<DocumentCommand, Document, Guid>>();
        allowOnceMock
            .Setup(a => a.AuthorizeAsync(It.IsAny<DocumentCommand>(), It.IsAny<Option<Document>>(), It.IsAny<IMessageContext>(), It.IsAny<CancellationToken>()))
            .Returns(Unit.Default);
        await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            createCommand, new Mock<IMessageContext>().Object, allowOnceMock.Object,
            state => decider.DecideAsync(state, createCommand, CancellationToken.None), CancellationToken.None
        );

        decideInvoked = false;
        var changeCommand = new ChangeDocument(id, "Updated");
        var changeResult = await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            changeCommand, new Mock<IMessageContext>().Object, authorizationMock.Object,
            state =>
            {
                decideInvoked = true;
                return decider.DecideAsync(state, changeCommand, CancellationToken.None);
            },
            CancellationToken.None
        );

        changeResult.Should().BeLeft().Which.Should().BeSameAs(denial);
        decideInvoked.Should().BeFalse();
        var loadedAfterChangeDenial = await repository.LoadAggregateAsync<Document, Guid>(id, CancellationToken.None);
        loadedAfterChangeDenial.Should().BeRight().Which.Should().BeSome().Which.Aggregate.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Data");
    }

    [Fact]
    public async Task ExecuteAsync_MapsExpectedStreamState_NoStreamOnCreatePath_ExactOnMutatePath()
    {
        var repositoryMock = new Mock<IAggregateRepository>();
        var publisher = new FakeEventPublisher();
        var executor = new EventSourcedCommandExecutor(repositoryMock.Object, publisher);
        var id = Guid.NewGuid();
        DocumentDomainEvent[] events = [new DocumentChanged(id, "Data")];

        // Create path: no existing aggregate.
        repositoryMock.Setup(r => r.LoadAggregateAsync<Document, Guid>(id, It.IsAny<CancellationToken>()))
            .Returns(Option<(Document, int)>.None);
        repositoryMock.Setup(r => r.AppendEventsAsync(id, events, It.IsAny<ExpectedStreamState>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult(Unit.Default));

        var createCommand = new CreateDocument(id, "Data");
        await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            createCommand, new Mock<IMessageContext>().Object, new AlwaysAllowAuthorization<DocumentCommand, Document, Guid>(),
            _ => (EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>)events, CancellationToken.None
        );

        repositoryMock.Verify(r => r.AppendEventsAsync(id, events, ExpectedStreamState.NoStream, It.IsAny<CancellationToken>()), Times.Once);

        // Mutate path: existing aggregate at version 3.
        var existing = new EditableDocument(id, "Old");
        repositoryMock.Setup(r => r.LoadAggregateAsync<Document, Guid>(id, It.IsAny<CancellationToken>()))
            .Returns(Option<(Document, int)>.Some(((Document)existing, 3)));

        var changeCommand = new ChangeDocument(id, "Data");
        await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            changeCommand, new Mock<IMessageContext>().Object, new AlwaysAllowAuthorization<DocumentCommand, Document, Guid>(),
            _ => (EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>)events, CancellationToken.None
        );

        repositoryMock.Verify(r => r.AppendEventsAsync(id, events, ExpectedStreamState.Exact(3), It.IsAny<CancellationToken>()), Times.Once);
    }

    // IAggregateEvent<,> only requires StreamId, so nothing stops a hand-written Level 2
    // handler from producing one that isn't also an Event — this fixture is exactly
    // that case, deliberately not derived from Event.
    private record NonEventAggregateEvent(Guid StreamId) : IAggregateEvent<Document, Guid>;

    [Fact]
    public async Task ExecuteAsync_ProducedEventIsNotAnEvent_ReturnsLeftWithClearError_NeverThrows()
    {
        var repositoryMock = new Mock<IAggregateRepository>();
        var id = Guid.NewGuid();
        repositoryMock.Setup(r => r.LoadAggregateAsync<Document, Guid>(id, It.IsAny<CancellationToken>()))
            .Returns(Option<(Document, int)>.None);
        repositoryMock.Setup(r => r.AppendEventsAsync(id, It.IsAny<IEnumerable<IAggregateEvent<Document, Guid>>>(), It.IsAny<ExpectedStreamState>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult(Unit.Default));
        var publisher = new FakeEventPublisher();
        var executor = new EventSourcedCommandExecutor(repositoryMock.Object, publisher);
        var command = new CreateDocument(id, "Data");
        IAggregateEvent<Document, Guid>[] badEvents = [new NonEventAggregateEvent(id)];

        Func<Task> act = async () => await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            command, new Mock<IMessageContext>().Object, new AlwaysAllowAuthorization<DocumentCommand, Document, Guid>(),
            _ => (EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>)badEvents, CancellationToken.None
        );
        await act.Should().NotThrowAsync();

        var result = await executor.ExecuteAsync<DocumentCommand, Document, Guid>(
            command, new Mock<IMessageContext>().Object, new AlwaysAllowAuthorization<DocumentCommand, Document, Guid>(),
            _ => (EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>>)badEvents, CancellationToken.None
        );

        result.Should().BeLeft().Which.Should().BeOfType<InvalidOperationException>()
            .Which.Message.Should().Contain(nameof(NonEventAggregateEvent));
        publisher.PublishedEvents.Should().BeEmpty();
    }
}
