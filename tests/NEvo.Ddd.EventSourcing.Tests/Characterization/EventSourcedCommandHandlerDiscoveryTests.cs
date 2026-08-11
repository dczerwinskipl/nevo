using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Context;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;

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
}
