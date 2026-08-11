using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Exceptions;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Owner code review (2026-08-11): IEventSourcedCommandHandler<,,>/
// EventSourcedCommandHandlerAdapter existed but were never wired into
// MessageHandlerExtractor's discovery — every prior Level 2 test constructed the
// adapter/executor by hand, never proving the real discovery -> registry -> dispatch
// flow. These tests exercise that real flow end-to-end via a genuine
// ServiceCollection/IMessageHandlerRegistry, the same way a real application would.
public class EventSourcedCommandHandlerDiscoveryTests
{
    private static ServiceProvider BuildProvider(FakeEventPublisher publisher, FakeReviewNotesProvider notesProvider)
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddMessages();
        services.AddEventSourcing(typeof(Document));
        services.AddSingleton<IEventPublisher>(publisher);
        services.AddSingleton<IReviewNotesProvider>(notesProvider);
        services.AddScoped<IEventSourcedCommandHandler<ApproveDocument, Document, Guid>, ApproveDocumentEventSourcedHandler>();
        services.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(ApproveDocumentEventSourcedHandler));
        });

        return services.BuildServiceProvider();
    }

    [Fact]
    public void GetMessageHandler_ForCommandWithARegisteredLevel2Handler_ResolvesToItAsPrimary_NotTheConventionFallback()
    {
        var provider = BuildProvider(new FakeEventPublisher(), new FakeReviewNotesProvider());
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(ApproveDocument));

        var handler = result.Should().BeRight().Which;
        handler.Should().BeOfType<EventSourcedCommandHandlerAdapter<ApproveDocument, Document, Guid>>();
        handler.HandlerDescription.Role.Should().Be(HandlerRole.Primary);
        handler.HandlerDescription.HandlerType.Should().Be(typeof(ApproveDocumentEventSourcedHandler));
    }

    [Fact]
    public void GetMessageHandler_ForCommandWithOnlyAConventionDecider_StillResolvesToTheFallback()
    {
        var provider = BuildProvider(new FakeEventPublisher(), new FakeReviewNotesProvider());
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        // CreateDocument has no registered Level 2 handler in this setup — only
        // Document.Create's convention decider — so it must still resolve as Fallback,
        // proving role-aware resolution doesn't break the convention-only case.
        var result = registry.GetMessageHandler(typeof(CreateDocument));

        var handler = result.Should().BeRight().Which;
        handler.HandlerDescription.Role.Should().Be(HandlerRole.Fallback);
    }

    [Fact]
    public async Task Dispatch_ApproveDocumentThroughTheRealPipeline_InvokesLevel2HandlerAndAppendsTheApprovedEvent()
    {
        var publisher = new FakeEventPublisher();
        var notesProvider = new FakeReviewNotesProvider();
        var provider = BuildProvider(publisher, notesProvider);
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
        var repository = provider.GetRequiredService<IAggregateRepository>();
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.ServiceProvider).Returns(provider);
        var id = Guid.NewGuid();

        // Create first, dispatched through the same real registry (resolves to the
        // convention Fallback, since no Level 2 handler is registered for CreateDocument).
        var createHandler = registry.GetMessageHandler(typeof(CreateDocument)).Should().BeRight().Which;
        var createResult = await createHandler.HandleAsync(new CreateDocument(id, "Data"), contextMock.Object, CancellationToken.None);
        createResult.Should().BeRight();

        // Approve, dispatched through the real registry — resolves to the Level 2
        // handler (Primary), discovered via EventSourcedCommandHandlerAdapterFactory.
        var approveHandler = registry.GetMessageHandler(typeof(ApproveDocument)).Should().BeRight().Which;
        var approveResult = await approveHandler.HandleAsync(new ApproveDocument(id), contextMock.Object, CancellationToken.None);

        approveResult.Should().BeRight();
        notesProvider.RequestedFor.Should().ContainSingle().Which.Should().Be(id);
        var loaded = await repository.LoadAggregateAsync<Document, Guid>(id, CancellationToken.None);
        loaded.Should().BeRight().Which.Should().BeSome().Which.Aggregate.Should().BeOfType<ApprovedDocument>();
        publisher.PublishedEvents.Should().Contain(e => e is DocumentApproved);
    }

    // Owner code review (2026-08-11): AggregateDecider can report one decider
    // description per concrete state type that declares a decision method for a given
    // command (here, EditableDocument.Change and ReviewableDocument.Change both exist
    // for ChangeDocument) — grouping convention-route registration only by command type
    // produced one competing Fallback candidate per description, so the registry
    // rejected the command as an unresolvable two-Fallback conflict before runtime state
    // ever got a chance to pick the applicable method.
    [Fact]
    public void GetMessageHandler_ForACommandWithMultipleStateSpecificDeciders_StillResolvesToOneFallbackRoute()
    {
        var provider = BuildProvider(new FakeEventPublisher(), new FakeReviewNotesProvider());
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(ChangeDocument));

        var handler = result.Should().BeRight().Which;
        handler.HandlerDescription.Role.Should().Be(HandlerRole.Fallback);
    }

    [Fact]
    public async Task Dispatch_ChangeDocumentAgainstARehydratedReviewableDocument_SelectsTheMostSpecificDeciderThroughTheRealPipeline()
    {
        var publisher = new FakeEventPublisher();
        var provider = BuildProvider(publisher, new FakeReviewNotesProvider());
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
        var contextMock = new Mock<IMessageContext>();
        contextMock.Setup(c => c.ServiceProvider).Returns(provider);
        var id = Guid.NewGuid();

        var createHandler = registry.GetMessageHandler(typeof(CreateDocument)).Should().BeRight().Which;
        await createHandler.HandleAsync(new CreateDocument(id, "Data"), contextMock.Object, CancellationToken.None);
        var flagHandler = registry.GetMessageHandler(typeof(FlagDocumentForReview)).Should().BeRight().Which;
        await flagHandler.HandleAsync(new FlagDocumentForReview(id), contextMock.Object, CancellationToken.None);

        // The stream now rehydrates to a ReviewableDocument. ChangeDocument is resolved
        // and dispatched entirely through the real registry — if the executor's decider
        // picked EditableDocument.Change (less specific) instead, the appended event's
        // Data would be missing the "-Reviewable" suffix.
        var changeHandler = registry.GetMessageHandler(typeof(ChangeDocument)).Should().BeRight().Which;
        var changeResult = await changeHandler.HandleAsync(new ChangeDocument(id, "Updated"), contextMock.Object, CancellationToken.None);

        changeResult.Should().BeRight();
        publisher.PublishedEvents.OfType<DocumentChanged>().Should().ContainSingle().Which.Data.Should().Be("Updated-Reviewable");
    }

    [Fact]
    public void GetMessageHandler_OrdinaryCommandHandlerAndExplicitHandlerForTheSameCommand_IsATwoPrimaryConflict()
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddMessages();
        services.AddCommands();
        services.AddEventSourcing(typeof(Document));
        services.AddSingleton<IEventPublisher>(new FakeEventPublisher());
        services.AddSingleton<IReviewNotesProvider>(new FakeReviewNotesProvider());
        services.AddScoped<IEventSourcedCommandHandler<ApproveDocument, Document, Guid>, ApproveDocumentEventSourcedHandler>();
        services.AddScoped<ICommandHandler<ApproveDocument>, OrdinaryApproveDocumentCommandHandler>();
        services.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(ApproveDocumentEventSourcedHandler));
            options.Handlers.Add(typeof(OrdinaryApproveDocumentCommandHandler));
        });
        var provider = services.BuildServiceProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(ApproveDocument));

        result.Should().BeLeft().Which.Should().BeOfType<MoreThanOneHandlerFoundException>();
    }

    private class OrdinaryApproveDocumentCommandHandler : ICommandHandler<ApproveDocument>
    {
        public Task<Either<Exception, Unit>> HandleAsync(ApproveDocument message, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }
}
