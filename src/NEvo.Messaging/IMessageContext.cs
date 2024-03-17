using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using System.Runtime.InteropServices;

namespace NEvo.Messaging;

public interface IMessageContext
{
    IMessageContextHeaders Headers { get; }
    Option<string> CorrelationId => Headers.CorrelationId;
    Option<string> CausationId => Headers.CausationId;
    IServiceProvider ServiceProvider { get; }
    IScopedMessageContext CreateScope();
}
