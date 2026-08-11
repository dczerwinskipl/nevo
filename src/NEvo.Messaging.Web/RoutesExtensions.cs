using LanguageExt;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Cqrs.Queries;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Transporting;

namespace Microsoft.AspNetCore.Routing
{
    public static class RoutesExtensions
    {
        public static RouteGroupBuilder MapMessagesEndpoints<T>(this T routeBuilder, string prefix = "/api/messages") where T : IEndpointRouteBuilder
        {
            var group = routeBuilder.MapGroup(prefix);

            group.MapPost("/dispatch", async (
                MessageEnvelopeDto dto,
                IMessageEnvelopeMapper mapper,
                IMessageProcessor messageProcessor,
                IMessageContextAccessor messageContextAccessor,
                IMessageContextProvider messageContextProvider,
                CancellationToken cancellationToken) =>
            {
                var result = await mapper
                    .ToMessageEnvelope(dto)
                    .BindAsync(async envelope =>
                    {
                        // TODO - read headers from envelope
                        var context = messageContextAccessor.MessageContext ??= messageContextProvider.CreateContext();
                        foreach (var header in envelope.Headers)
                        {
                            context.Headers.Add(header.Key, header.Value);
                        }
                        return await messageProcessor.ProcessMessageAsync(envelope.Message, messageContextAccessor.MessageContext, cancellationToken);
                    });

                return result.Match(
                   Right: result => Results.Ok(result),
                   Left: ex => Results.Problem(detail: ex.Message, statusCode: 500)
                );
            });

            return group;
        }

        public static RouteHandlerBuilder MapCommandEndpoint<TCommand>(this IEndpointRouteBuilder routeBuilder, string routeName)
            where TCommand : Command
        {
            var handler = routeBuilder.MapPost(routeName, async (TCommand command, CancellationToken token, ICommandDispatcher commandDispatcher) =>
            {
                var result = await commandDispatcher.DispatchAsync(command, token);

                return result.ToHttpResult();
            });

            return handler;
        }

        public static RouteHandlerBuilder MapQueryEndpoint<TQuery, TResult>(this IEndpointRouteBuilder routeBuilder, string routeName)
            where TQuery : Query<TResult>
        {
            var handler = routeBuilder.MapGet(routeName, async ([AsParameters] TQuery query, CancellationToken token, IQueryDispatcher queryDispatcher) =>
            {
                var result = await queryDispatcher.DispatchAsync(query, token);

                return result.ToHttpResult();
            });

            return handler;
        }

        // Shared Right→200/Left→Problem mapping between MapCommandEndpoint and
        // MapQueryEndpoint — not a general HTTP result-mapping framework, just removes
        // the one duplicated Match between the two.
        private static IResult ToHttpResult<TResult>(this Either<Exception, TResult> result)
            => result.Match(
                Right: value => Results.Ok(value),
                Left: ex => Results.Problem(detail: ex.Message, statusCode: 500)
            );
    }
}
