using Microsoft.Extensions.DependencyInjection;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Characterizes AddEventSourcing's current DI registrations, ahead of the additive
// options overload that later configures the convention-fallback toggle.
public class ServiceCollectionExtensionsBaselineTests
{
    [Fact]
    public void AddEventSourcing_FreshServiceCollection_ResolvesAllExpectedServices()
    {
        var services = new ServiceCollection();
        services.AddEventSourcing(typeof(Document));

        var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IEventStreamStore>().Should().NotBeNull();
        provider.GetRequiredService<IAggregateRepository>().Should().NotBeNull();
        provider.GetRequiredService<IMessageHandlerProvider>().Should().NotBeNull();
        provider.GetRequiredService<IEvolverRegistry>().Should().NotBeNull();
        provider.GetRequiredService<IDeciderRegistry>().Should().NotBeNull();
        provider.GetRequiredService<IDecider>().Should().NotBeNull();
        provider.GetRequiredService<IAggregateDeciderProvider>().Should().NotBeNull();
        provider.GetRequiredService<IEvolver>().Should().NotBeNull();
    }
}
