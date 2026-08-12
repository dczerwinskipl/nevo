using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Proves the explicit Level 2 handler and its adapter route through the same executor
// Level 1 uses, delegate to Level 1's own decision-method discovery instead of
// duplicating a transition, can use a constructor-injected dependency for
// orchestration, and receive Option<TAggregate> correctly on both the mutate and
// create paths.
public class EventSourcedCommandHandlerTests
{
    private static AggregateDecider CreateLevel1Decider()
    {
        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { typeof(Document) } };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        return new AggregateDecider(deciderProvider, new MessageContextAccessor());
    }

    private static AggregateRepository CreateRepository(out FakeEventPublisher publisher)
    {
        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { typeof(Document) } };
        var evolver = new AggregateEvolver(Options.Create(configuration));
        var evolverRegistry = new EvolverRegistry([evolver]);
        publisher = new FakeEventPublisher();
        return new AggregateRepository(new FakeEventStore(), evolverRegistry);
    }

    [Fact]
    public async Task ApproveDocumentEventSourcedHandler_DelegatesToLevel1Discovery_ProducesIdenticalEventToADirectLevel1Call()
    {
        var decider = CreateLevel1Decider();
        var notesProvider = new FakeReviewNotesProvider();
        var handler = new ApproveDocumentEventSourcedHandler(decider, notesProvider);
        var id = Guid.NewGuid();
        var aggregate = Option<Document>.Some(new EditableDocument(id, "Data"));
        var command = new ApproveDocument(id);

        var level1Result = await decider.DecideAsync(aggregate, command, CancellationToken.None);
        var level2Result = await handler.HandleAsync(command, (Option<Document>)aggregate, CancellationToken.None);

        level1Result.Should().BeRight();
        level2Result.Should().BeRight().Which.Should().BeEquivalentTo(
            (IEnumerable<IAggregateEvent<Document, Guid>>)level1Result.IfLeft([]),
            options => options.Excluding(e => ((DocumentDomainEvent)e).Id).Excluding(e => ((DocumentDomainEvent)e).CreatedAt)
        );
    }

    [Fact]
    public async Task ApproveDocumentEventSourcedHandler_UsesInjectedDependency_BeforeDelegatingToTheDecision()
    {
        var decider = CreateLevel1Decider();
        var notesProvider = new FakeReviewNotesProvider();
        var handler = new ApproveDocumentEventSourcedHandler(decider, notesProvider);
        var id = Guid.NewGuid();
        var command = new ApproveDocument(id);

        await handler.HandleAsync(command, new EditableDocument(id, "Data"), CancellationToken.None);

        notesProvider.RequestedFor.Should().ContainSingle().Which.Should().Be(id);
    }

    [Fact]
    public async Task CreateDocumentEventSourcedHandler_NoExistingAggregate_ReceivesNoneAndProducesAValidCreationDecision()
    {
        var decider = CreateLevel1Decider();
        var handler = new CreateDocumentEventSourcedHandler(decider);
        var id = Guid.NewGuid();
        var command = new CreateDocument(id, "Data");

        var result = await handler.HandleAsync(command, Option<Document>.None, CancellationToken.None);

        result.Should().BeRight().Which.Should().BeEquivalentTo(
            [new DocumentCreated(id, "Data")],
            options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
        );
    }

    [Fact]
    public void Adapter_ResolvesTheHandlerThroughDI_WithOnlyIAggregateMethodDeciderRegistered_NoConcreteAggregateDeciderNeeded()
    {
        var repository = CreateRepository(out var publisher);
        var provider = BuildServiceProvider(repository, publisher);

        // BuildServiceProvider registers only IAggregateMethodDecider, never the
        // concrete AggregateDecider type — this proves CreateDocumentEventSourcedHandler
        // (which depends on IAggregateMethodDecider) is fully resolvable through DI
        // without it.
        provider.GetService(typeof(AggregateDecider)).Should().BeNull();
        var handler = provider.GetRequiredService<IEventSourcedCommandHandler<CreateDocument, Document, Guid>>();
        handler.Should().NotBeNull();
    }

    [Fact]
    public async Task Adapter_CreatePath_ExecutesThroughSharedExecutor_PersistingTheNewStream()
    {
        var repository = CreateRepository(out var publisher);
        var provider = BuildServiceProvider(repository, publisher);
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.ServiceProvider).Returns(provider);
        var handlerDescription = new MessageHandlerDescription("create-document", typeof(EventSourcedCommandHandlerAdapter<CreateDocument, Document, Guid>), typeof(CreateDocument), null, typeof(Unit));
        var adapter = new EventSourcedCommandHandlerAdapter<CreateDocument, Document, Guid>(NullLogger<EventSourcedCommandHandlerAdapter<CreateDocument, Document, Guid>>.Instance, handlerDescription);
        var id = Guid.NewGuid();

        var result = await adapter.HandleAsync(new CreateDocument(id, "Data"), contextMock.Object, CancellationToken.None);

        result.Should().BeRight();
        var loaded = await repository.LoadAggregateAsync<Document, Guid>(id, CancellationToken.None);
        loaded.Should().BeRight().Which.Should().BeSome().Which.Aggregate.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Data");
        publisher.PublishedEvents.Should().ContainSingle().Which.Should().BeOfType<DocumentCreated>();
    }

    [Fact]
    public async Task Adapter_AppendHappensBeforePublish_SameOrderingGuaranteeAsLevel1()
    {
        var repository = CreateRepository(out _);
        AggregateRepository? capturedRepository = repository;
        Document? observedDuringPublish = null;
        var id = Guid.NewGuid();
        var recordingPublisher = new RecordingEventPublisher(async (_, ct) =>
        {
            var loaded = await capturedRepository!.LoadAggregateAsync<Document, Guid>(id, ct);
            loaded.IfRight(option => option.IfSome(value => observedDuringPublish = value.Aggregate));
        });
        var provider = BuildServiceProvider(repository, recordingPublisher);
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.ServiceProvider).Returns(provider);
        var handlerDescription = new MessageHandlerDescription("create-document", typeof(EventSourcedCommandHandlerAdapter<CreateDocument, Document, Guid>), typeof(CreateDocument), null, typeof(Unit));
        var adapter = new EventSourcedCommandHandlerAdapter<CreateDocument, Document, Guid>(NullLogger<EventSourcedCommandHandlerAdapter<CreateDocument, Document, Guid>>.Instance, handlerDescription);

        var result = await adapter.HandleAsync(new CreateDocument(id, "Data"), contextMock.Object, CancellationToken.None);

        result.Should().BeRight();
        observedDuringPublish.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Data");
    }

    private class RecordingEventPublisher(Func<Event, CancellationToken, Task> onPublish) : IEventPublisher
    {
        public async Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken)
        {
            await onPublish(@event, cancellationToken);
            return Unit.Default;
        }
    }

    private static IServiceProvider BuildServiceProvider(AggregateRepository repository, IEventPublisher publisher)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IAggregateRepository>(repository);
        services.AddSingleton(publisher);
        services.AddSingleton<IEventSourcedCommandExecutor, EventSourcedCommandExecutor>();
        services.AddSingleton<IAggregateMethodDecider>(CreateLevel1Decider());
        services.AddSingleton<IEventSourcedCommandHandler<CreateDocument, Document, Guid>, CreateDocumentEventSourcedHandler>();
        services.AddSingleton(typeof(IAggregateAuthorization<,,>), typeof(AlwaysAllowAuthorization<,,>));
        return services.BuildServiceProvider();
    }
}
