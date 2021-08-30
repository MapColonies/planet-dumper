#!/usr/bin/env python3
import os
import sys
import boto3
import requests
import json
from botocore.exceptions import ClientError, EndpointConnectionError, SSLError
from boto3.exceptions import S3UploadFailedError
from datetime import datetime, timezone

from MapColoniesJSONLogger.logger import generate_logger
from osmeterium.run_command import run_command_async, run_command

app_name = 'planet-dumper'
planet_dump_ng = 'planet-dump-ng'
pg_dump = 'pg_dump'
log = None
pg_dump_log = None
planet_dump_ng_log = None
TABLE_DUMPS_PATH = '/tmp'
NG_DUMPS_PATH = '/tmp'
DUMP_FILE_FORMAT = 'pbf'
object_strorage_config = {}
dump_server_config = {}
postgres_config = {}

DEFAULT_DUMP_ACL = 'public-read'

EXIT_CODES = {
    'success': 0,
    'general_error': 1,
    'pg_dump_error': 100,
    'planet-dump-ng_error': 101,
    's3_general_error': 102,
    's3_connection_error': 103,
    's3_upload_error': 104,
    's3_bucket_not_exist': 105,
    'object_key_already_exists': 106,
    'missing_env_arg': 107,
    'dump_server_upload_error': 108,
    'dump_server_request_error': 109
}

DUMP_NAME_PREFIX = os.getenv('DUMP_NAME_PREFIX')
UPLOAD_TO_OBJECT_STORAGE = os.getenv('UPLOAD_TO_OBJECT_STORAGE')
UPLOAD_TO_DUMP_SERVER = os.getenv('UPLOAD_TO_DUMP_SERVER')
POSTGRES_ENABLE_SSL_AUTH = os.getenv('POSTGRES_ENABLE_SSL_AUTH')
DUMP_ACL = os.getenv('DUMP_ACL', DEFAULT_DUMP_ACL)

class BucketDoesNotExistError(Exception):
    pass

class ObjectKeyAlreadyExists(Exception):
    pass

def load_env():
    try:
        if convert_string_to_bool(UPLOAD_TO_OBJECT_STORAGE):
            object_strorage_config['protocol'] = os.environ['OBJECT_STORAGE_PROTOCOL']
            object_strorage_config['host'] = os.environ['OBJECT_STORAGE_HOST']
            object_strorage_config['port'] = os.environ['OBJECT_STORAGE_PORT']
            object_strorage_config['access_key_id'] = os.environ['OBJECT_STORAGE_ACCESS_KEY_ID']
            object_strorage_config['secret_access_key'] = os.environ['OBJECT_STORAGE_SECRET_ACCESS_KEY']
            object_strorage_config['bucket_name'] = os.environ['OBJECT_STORAGE_BUCKET']
            object_strorage_config['should_use_ssl'] = convert_string_to_bool(os.getenv('OBJECT_STORAGE_USE_SSL'))
            object_strorage_config['verify_root_cert'] = convert_string_to_bool(os.getenv('OBJECT_STORAGE_VERIFY_ROOT_CERT'))
            if object_strorage_config['verify_root_cert']:
                object_storage_cert_dir = os.environ['OBJECT_STORAGE_CERT_DIR']
                object_storage_cert_name = os.environ['OBJECT_STORAGE_CERT_NAME']
                object_strorage_config['verify_root_cert_path'] = os.path.join(object_storage_cert_dir, object_storage_cert_name)

            if convert_string_to_bool(UPLOAD_TO_DUMP_SERVER):
                dump_server_config['protocol'] = os.environ['DUMP_SERVER_PROTOCOL']
                dump_server_config['host'] = os.environ['DUMP_SERVER_HOST']
                dump_server_config['port'] = os.environ['DUMP_SERVER_PORT']
                dump_server_config['path'] = os.environ['DUMP_SERVER_PATH']
                dump_server_config['token'] = os.environ['DUMP_SERVER_TOKEN']
                dump_server_config['verify_root_cert'] = convert_string_to_bool(os.getenv('DUMP_SERVER_VERIFY_ROOT_CERT'))
                if dump_server_config['verify_root_cert']:
                    dump_server_cert_dir = os.environ['DUMP_SERVER_CERT_DIR']
                    dump_server_cert_name = os.environ['DUMP_SERVER_CERT_NAME']
                    dump_server_config['verify_root_cert_path'] = os.path.join(dump_server_cert_dir, dump_server_cert_name)

        if convert_string_to_bool(POSTGRES_ENABLE_SSL_AUTH):
            postgres_config['host'] = os.environ['POSTGRES_HOST']
            postgres_config['port'] = os.environ['POSTGRES_PORT']
            postgres_config['user'] = os.environ['POSTGRES_USER']
            postgres_config['database'] = os.environ['POSTGRES_DB']
            postgres_config['ssl_cert'] = os.environ['POSTGRES_SSL_CERT']
            postgres_config['ssl_key'] = os.environ['POSTGRES_SSL_KEY']
            postgres_config['ssl_root_cert'] = os.environ['POSTGRES_SSL_ROOT_CERT']
        else:
            os.environ['PGHOST'] = os.environ['POSTGRES_HOST']
            os.environ['PGPORT'] = os.environ['POSTGRES_PORT']
            os.environ['PGUSER'] = os.environ['POSTGRES_USER']
            os.environ['PGDATABASE'] = os.environ['POSTGRES_DB']
            os.environ['PGPASSWORD'] = os.environ['POSTGRES_PASSWORD']
    except KeyError as missing_key:
        log_and_exit(f'missing required environment argument {missing_key}', EXIT_CODES['missing_env_arg'])

def log_and_exit(exception_message, exit_code):
    log.error(exception_message)
    sys.exit(exit_code)

def map_subprocess_name_to_error(subprocess_name):
    exit_code_value = 'general_error'
    logged_message_head = 'the subprocess'
    if subprocess_name in [pg_dump, planet_dump_ng]:
        exit_code_value = f'{subprocess_name}_error'
        logged_message_head = subprocess_name
    return (EXIT_CODES[exit_code_value], logged_message_head)

def subprocess_error_handler_wrapper(subprocess_name):
    (exit_code_value, logged_message_head) = map_subprocess_name_to_error(subprocess_name)
    def error_handler(exit_code):
        log_and_exit(exception_message=f'{logged_message_head} raised an error: {exit_code}', exit_code=exit_code_value)
    return error_handler

def run_subprocess_command(subprocess_name, subprocess_log, *argv):
    command_str = ' '.join((subprocess_name,) + argv)
    run_command(command_str,
        subprocess_log.info,
        subprocess_log.info,
        subprocess_error_handler_wrapper(subprocess_name),
        (lambda: log.info(f'the subprocess {subprocess_name} finished successfully.')))

def create_dump_table(dump_table_name):
    table_dump_file_path = os.path.join(TABLE_DUMPS_PATH, dump_table_name)
    args = ('--format=custom', f'--file={table_dump_file_path}')
    if convert_string_to_bool(POSTGRES_ENABLE_SSL_AUTH):
        args = args + (get_ssl_connection(), )
    run_subprocess_command(pg_dump, pg_dump_log, ' '.join(args))
    return table_dump_file_path

def get_ssl_connection():
    host = postgres_config['host']
    port = postgres_config['port']
    user = postgres_config['user']
    database = postgres_config['database']
    ssl_cert = postgres_config['ssl_cert']
    ssl_key = postgres_config['ssl_key']
    ssl_root_cert = postgres_config['ssl_root_cert']
    return f'"host={host} port={port} user={user} dbname={database} sslcert={ssl_cert} sslkey={ssl_key} sslrootcert={ssl_root_cert}"'

def create_ng_dump(table_dump_file_path, dump_ng_name):
    ng_dump_file_path = os.path.join(NG_DUMPS_PATH, f'{dump_ng_name}')
    run_subprocess_command(planet_dump_ng, planet_dump_ng_log, f'-p {ng_dump_file_path}', f'-f {table_dump_file_path}')
    return ng_dump_file_path

def get_current_datetime():
    return datetime.now(tz=timezone.utc)

def format_datetime(datetime):
    return datetime.strftime(r'%Y-%m-%dT%H:%M:%SZ')

def convert_string_to_bool(input):
    if input is None:
        return False
    return input.lower() in ['true', '1', 't', 'y', 'yes']

def initialize_s3_client():
    protocol = object_strorage_config['protocol']
    host = object_strorage_config['host']
    port = object_strorage_config['port']
    verify=False
    if object_strorage_config['verify_root_cert']:
        verify = object_strorage_config['verify_root_cert_path']
    return boto3.resource('s3', endpoint_url=f'{protocol}://{host}:{port}',
                                aws_access_key_id=object_strorage_config['access_key_id'],
                                aws_secret_access_key=object_strorage_config['secret_access_key'],
                                use_ssl=object_strorage_config['should_use_ssl'],
                                verify=verify)

def get_dump_server_url():
    protocol = dump_server_config['protocol']
    host = dump_server_config['host']
    port = dump_server_config['port']
    path = dump_server_config['path']
    return f'{protocol}://{host}:{port}/{path}'

def upload_to_s3(file_path, bucket_name, dump_key):
    log.info(f'starting the upload of {file_path} to s3 bucket {bucket_name} as {dump_key}')
    try:
        # get a client
        s3_client = initialize_s3_client()

        bucket = s3_client.Bucket(bucket_name)

        # validate bucket exists
        if not bucket in s3_client.buckets.all():
            raise BucketDoesNotExistError(f'The specified bucket ({bucket_name}) does not exist')

        # validate key does not exitst on bucket
        objects = list(bucket.objects.filter(Prefix=dump_key))
        if any([obj.key == dump_key for obj in objects]):
            raise ObjectKeyAlreadyExists(f'Object key: {dump_key} already exists on the bucket: {bucket_name}')

        # upload dump
        bucket.upload_file(file_path, dump_key, ExtraArgs={'ACL': DUMP_ACL })

    except (EndpointConnectionError, SSLError) as connection_error:
        log_and_exit(str(connection_error), EXIT_CODES['s3_connection_error'])

    except S3UploadFailedError as upload_error:
        log_and_exit(str(upload_error), EXIT_CODES['s3_upload_error'])

    except BucketDoesNotExistError as bucket_not_exist_error:
        log_and_exit(bucket_not_exist_error, EXIT_CODES['s3_bucket_not_exist'])

    except ObjectKeyAlreadyExists as key_already_exists_error:
        log_and_exit(key_already_exists_error, EXIT_CODES['object_key_already_exists'])

    except Exception as error:
        log_and_exit(f'failed uploading file: { file_path } into s3 bucket: {bucket_name} as {dump_key} with error: {error}', EXIT_CODES['s3_general_error'])

    log.info(f'success on uploading file: { file_path } into s3 bucket: {bucket_name} with key: {dump_key}')

def upload_to_dump_server(dump_name, bucket_name, dump_timestamp, dump_description=None):
    dump_server_url = get_dump_server_url()
    dump_metadata_creation_body = { 'name': dump_name, 'bucket': bucket_name, 'timestamp': dump_timestamp }
    if (dump_description):
        dump_metadata_creation_body['description'] = dump_description
    try:
        token = dump_server_config['token']
        verify=False
        if dump_server_config['verify_root_cert']:
            verify = dump_server_config['verify_root_cert_path']
        request = requests.post(url=dump_server_url,
                                json=dump_metadata_creation_body,
                                headers={'Authorization': f'Bearer {token}'},
                                verify=verify)
    except requests.exceptions.RequestException as request_exception:
        log_and_exit(request_exception, EXIT_CODES['dump_server_request_error'])

    if not request.ok:
        log_and_exit(f'failed uploading dump metadata: {dump_name} to dump-server. status code: {request.status_code}, {request.text}',
                    EXIT_CODES['dump_server_upload_error'])
    log.info(f'success on uploading dump metadata: { dump_name } to dump-server')

def main():
    log.info(f'{app_name} container started')
    load_env()
    timestamp = format_datetime(get_current_datetime())
    if DUMP_NAME_PREFIX:
        dump_name = f'{DUMP_NAME_PREFIX}_{timestamp}'
    else:
        dump_name=timestamp

    dump_name_with_file_format = f'{dump_name}.{DUMP_FILE_FORMAT}'

    # create dump_table using pg_dump
    created_dump_table_path = create_dump_table(dump_table_name=dump_name)

    # create pbf dump using planet_dump_ng
    created_ng_dump_path = create_ng_dump(table_dump_file_path=created_dump_table_path, dump_ng_name=dump_name_with_file_format)

    # upload to object storage
    if convert_string_to_bool(UPLOAD_TO_OBJECT_STORAGE):
        bucket_name = object_strorage_config['bucket_name']
        upload_to_s3(file_path=created_ng_dump_path, bucket_name=bucket_name, dump_key=dump_name_with_file_format)
        if convert_string_to_bool(UPLOAD_TO_DUMP_SERVER):
            upload_to_dump_server(dump_name=dump_name_with_file_format, bucket_name=bucket_name, dump_timestamp=timestamp)

    log.info(f'{app_name} container finished job successfully')
    exit(EXIT_CODES['success'])

if __name__ == '__main__':
    log = generate_logger(app_name, log_level='INFO', handlers=[{ 'type': 'stream', 'output': 'stderr' }])
    pg_dump_log = generate_logger(pg_dump, log_level='INFO', handlers=[{ 'type': 'stream', 'output': 'stderr' }])
    planet_dump_ng_log = generate_logger(planet_dump_ng, log_level='INFO', handlers=[{ 'type': 'stream', 'output': 'stderr' }])
    main()
