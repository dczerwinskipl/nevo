using Microsoft.Extensions.DependencyInjection;

namespace NEvo.Messaging.Context;

public class ScopedMessageContext(IDictionary<string, string> headers, IServiceProvider serviceProvider) : IScopedMessageContext
{
    public IMessageContextHeaders Headers { get; } = new MessageContextHeaders(Check.Null(headers));

    private IServiceScope _serviceScope = Check.Null(serviceProvider).CreateScope();

    public IServiceProvider ServiceProvider => _serviceScope.ServiceProvider;

    public void Dispose()
    {
        _serviceScope?.Dispose();
    }

    public IScopedMessageContext CreateScope() => new ScopedMessageContext(Headers.ToDictionary(), ServiceProvider);
}