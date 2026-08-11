using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Exceptions;

namespace NEvo.Ddd.EventSourcing.Tests;

public class ServiceCollectionExtensionsOptionsTests
{
    private static ServiceProvider BuildProvider(Action<EventSourcingOptions>? configure = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddMessages();
        if (configure is null)
        {
            services.AddEventSourcing(typeof(Document));
        }
        else
        {
            services.AddEventSourcing(configure, typeof(Document));
        }
        services.AddSingleton<IEventPublisher>(new FakeEventPublisher());
        services.AddSingleton<IReviewNotesProvider>(new FakeReviewNotesProvider());
        services.AddScoped<IEventSourcedCommandHandler<ApproveDocument, Document, Guid>, ApproveDocumentEventSourcedHandler>();
        services.Configure<MessageHandlerExtractorConfiguration>(options =>
        {
            options.Handlers.Add(typeof(ApproveDocumentEventSourcedHandler));
        });

        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddEventSourcing_DefaultOverload_ConventionFallbackEnabled_ResolvesACommandWithOnlyAConventionHandler()
    {
        var provider = BuildProvider();
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(CreateDocument));

        result.Should().BeRight();
    }

    [Fact]
    public void AddEventSourcing_ConventionFallbackExplicitlyEnabled_ResolvesACommandWithOnlyAConventionHandler()
    {
        var provider = BuildProvider(options => options.UseAggregateMethodFallback = true);
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(CreateDocument));

        result.Should().BeRight();
    }

    [Fact]
    public void AddEventSourcing_ConventionFallbackDisabled_CommandWithOnlyAConventionHandler_HasNoRegisteredHandler()
    {
        var provider = BuildProvider(options => options.UseAggregateMethodFallback = false);
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(CreateDocument));

        result.Should().BeLeft().Which.Should().BeOfType<NoHandlerFoundException>();
    }

    [Fact]
    public void AddEventSourcing_ConventionFallbackDisabled_ExplicitHandlerForADifferentCommand_RemainsUsable()
    {
        var provider = BuildProvider(options => options.UseAggregateMethodFallback = false);
        var registry = provider.GetRequiredService<IMessageHandlerRegistry>();

        var result = registry.GetMessageHandler(typeof(ApproveDocument));

        result.Should().BeRight();
    }

    [Fact]
    public void AddEventSourcing_DefaultOverload_PopulatesAggregateExtractorConfiguration()
    {
        var services = new ServiceCollection();
        services.AddEventSourcing(typeof(Document));

        var configuration = services.BuildServiceProvider().GetRequiredService<IOptions<AggregateExtractorConfiguration>>().Value;

        configuration.AggregateTypes.Should().Contain(typeof(Document));
    }

    [Fact]
    public void AddEventSourcing_AdditiveOverload_PopulatesAggregateExtractorConfiguration()
    {
        var services = new ServiceCollection();
        services.AddEventSourcing(options => options.UseAggregateMethodFallback = false, typeof(Document));

        var configuration = services.BuildServiceProvider().GetRequiredService<IOptions<AggregateExtractorConfiguration>>().Value;

        configuration.AggregateTypes.Should().Contain(typeof(Document));
    }
}
